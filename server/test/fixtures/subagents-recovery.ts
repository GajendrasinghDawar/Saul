import assert from 'node:assert/strict'
import test from 'node:test'
import { BACKGROUND_CONTEXT as ctx } from '@earendil-works/chord/context'
import {
  createModels,
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from '@earendil-works/pi-ai'
import {
  AssistantEntry,
  configure,
  createRegistry,
  defineExtension,
  defineTask,
  Harness,
  UserEntry,
} from '@earendil-works/pi-durable'
import { openNodeSqliteStorage } from '@earendil-works/pi-durable/storage/sqlite/node'
import { Reporter } from '../../agent/subagents/tasks.ts'
import { SubagentExtension, subagentTool } from '../../agent/subagents/tool.ts'

test('subagent tool reuses spawn and send after SQLite reopen', {
  timeout: 15000,
}, async () => {
  const path = 'recovery.sqlite'
  const faux = fauxProvider({ tokensPerSecond: 100000 })
  const models = createModels()
  models.setProvider(faux.provider)
  let interrupt = true
  let reached = Promise.withResolvers<void>()
  let release = Promise.withResolvers<void>()
  const results: string[] = []
  const registry = createRegistry()
  registry.install(
    defineExtension({
      ...SubagentExtension,
      tools: [
        {
          ...subagentTool,
          // The wrapper only inserts an interruption after the real tool returns.
          execute: async (
            ...[args, api, context]: Parameters<typeof subagentTool.execute>
          ) => {
            const result = await subagentTool.execute(args, api, context)
            results.push(JSON.stringify(result))
            if (interrupt) {
              reached.resolve()
              await release.promise
            }
            return result
          },
        },
      ],
    })
  )
  const options = {
    models,
    registry,
    conversationCreated: async (
      tx: Parameters<typeof configure>[0],
      conversation: { id: Parameters<typeof configure>[1] }
    ) => {
      await configure(tx, conversation.id, {
        model: { provider: 'faux', modelId: 'faux-1' },
      })
    },
  }
  let harness = await Harness.open(
    await openNodeSqliteStorage(path),
    options,
    ctx
  )
  try {
    const parent = await harness.createConversation(
      { ownership: { kind: 'ownerless' } },
      ctx
    )
    for (const action of ['spawn', 'send'] as const) {
      interrupt = true
      reached = Promise.withResolvers<void>()
      release = Promise.withResolvers<void>()
      faux.setResponses([
        fauxAssistantMessage(
          fauxToolCall('manage_subagents', {
            action,
            name: 'worker',
            message: action,
          }),
          { stopReason: 'toolUse' }
        ),
        ...Array.from({ length: 12 }, () => fauxAssistantMessage('answer')),
      ])
      const current = await harness.conversation(parent.id, ctx)
      assert.ok(current)
      await current.submit({ type: 'input', content: action }, ctx)
      await reached.promise
      const before = await harness.commit(
        tx => tx.scanTasks({ kind: 'lali.subagent-reporter' }, 100),
        ctx
      )
      const children = await harness.commit(
        tx => tx.scanConversations({}, 100),
        ctx
      )
      interrupt = false
      const closing = harness.close(ctx)
      release.resolve()
      await closing
      harness = await Harness.open(
        await openNodeSqliteStorage(path),
        options,
        ctx
      )
      await harness.waitForIdle(ctx)
      assert.equal(
        results.at(-1),
        results.at(-2),
        `${action} replay returns the original result`
      )
      const reporters = await harness.commit(
        tx => tx.scanTasks({ kind: 'lali.subagent-reporter' }, 100),
        ctx
      )
      assert.equal(reporters.items.length, before.items.length)
      for (const reporter of reporters.items) {
        const settled = await harness.waitForTask(reporter.id, ctx)
        assert.equal(settled.state.outcome.status, 'completed')
      }
      assert.equal(
        (await harness.commit(tx => tx.scanConversations({}, 100), ctx)).items
          .length,
        children.items.length
      )
      const child = children.items.find(child => child.id !== parent.id)
      assert.ok(child)
      const entries = await harness.commit(
        tx => tx.scanEntries({ conversationId: child.id }, 100),
        ctx
      )
      assert.equal(
        entries.items.filter(entry => UserEntry.is(entry)).length,
        action === 'spawn' ? 1 : 2,
        'each request is delivered once'
      )
      await harness.waitForIdle(ctx)
    }
    faux.setResponses([
      fauxAssistantMessage(
        fauxToolCall('manage_subagents', {
          action: 'spawn',
          name: 'worker',
          message: 'different task',
        }),
        { stopReason: 'toolUse' }
      ),
      fauxAssistantMessage('answer'),
    ])
    const current = await harness.conversation(parent.id, ctx)
    assert.ok(current)
    await (
      await current.submit({ type: 'input', content: 'duplicate name' }, ctx)
    ).wait(ctx)
    assert.match(results.at(-1) ?? '', /worker already exists; use send/)
    assert.equal(
      (
        await harness.commit(
          tx => tx.scanTasks({ kind: 'lali.subagent-reporter' }, 100),
          ctx
        )
      ).items.length,
      2
    )
  } finally {
    await harness.close(ctx)
  }
})

for (const phase of ['deliver', 'report'] as const) {
  test(`subagent reporter replays ${phase} checkpoint window after SQLite reopen`, {
    timeout: 15000,
  }, async () => {
    const path = `reporter-${phase}.sqlite`
    const faux = fauxProvider({ tokensPerSecond: 100000 })
    const models = createModels()
    models.setProvider(faux.provider)
    let interrupt = false
    let reached = Promise.withResolvers<void>()
    const definition = Reporter.definition
    const wrapRuntime = (
      runtime: Parameters<typeof definition.phases.deliver>[1]
    ) => {
      // Run the real phase, stopping only its final checkpoint commit.
      return new Proxy(runtime, {
        get(target, key) {
          if (key !== 'commit') return Reflect.get(target, key, target)
          return async (...args: Parameters<typeof runtime.commit>) => {
            if (interrupt) {
              const stopped = new Promise<void>(resolve => {
                target.signal.addEventListener('abort', () => resolve(), {
                  once: true,
                })
              })
              reached.resolve()
              await stopped
              target.signal.throwIfAborted()
            }
            return target.commit(...args)
          }
        },
      })
    }
    const wrappedReporter = defineTask({
      ...definition,
      phases: {
        deliver: (reporter, runtime, taskContext) =>
          definition.phases.deliver(
            reporter,
            phase === 'deliver' ? wrapRuntime(runtime) : runtime,
            taskContext
          ),
        report: (reporter, runtime, taskContext) =>
          definition.phases.report(
            reporter,
            phase === 'report' ? wrapRuntime(runtime) : runtime,
            taskContext
          ),
      },
    })
    const registry = createRegistry()
    registry.install(
      defineExtension({
        ...SubagentExtension,
        tasks: SubagentExtension.tasks?.map(task =>
          task === Reporter ? wrappedReporter : task
        ),
      })
    )
    const options = {
      models,
      registry,
      conversationCreated: async (
        tx: Parameters<typeof configure>[0],
        conversation: { id: Parameters<typeof configure>[1] }
      ) => {
        await configure(tx, conversation.id, {
          model: { provider: 'faux', modelId: 'faux-1' },
        })
      },
    }
    let harness = await Harness.open(
      await openNodeSqliteStorage(path),
      options,
      ctx
    )
    try {
      const parent = await harness.createConversation(
        { ownership: { kind: 'ownerless' } },
        ctx
      )
      for (const action of ['spawn', 'send'] as const) {
        interrupt = true
        reached = Promise.withResolvers<void>()
        faux.setResponses([
          fauxAssistantMessage(
            fauxToolCall('manage_subagents', {
              action,
              name: 'worker',
              message: action,
            }),
            { stopReason: 'toolUse' }
          ),
          ...Array.from({ length: 12 }, () => fauxAssistantMessage('answer')),
        ])
        const current = await harness.conversation(parent.id, ctx)
        assert.ok(current)
        await current.submit({ type: 'input', content: action }, ctx)
        await reached.promise
        const reporters = await harness.commit(
          tx => tx.scanTasks({ kind: definition.name }, 100),
          ctx
        )
        const reporter = reporters.items.find(
          task => task.state.status === 'running'
        )
        assert.ok(reporter)
        const children = await harness.commit(
          tx => tx.scanConversations({}, 100),
          ctx
        )
        const child = children.items.find(item => item.id !== parent.id)
        assert.ok(child)
        const childBefore = await harness.commit(
          tx => tx.scanEntries({ conversationId: child.id }, 100),
          ctx
        )
        const expected = action === 'spawn' ? 1 : 2
        assert.equal(childBefore.items.filter(UserEntry.is).length, expected)
        assert.equal(
          childBefore.items.filter(AssistantEntry.is).length,
          expected,
          'child answer is committed before interruption'
        )
        // Report submission can be queued behind the parent's tool response.
        await current.waitForIdle(ctx)
        const parentBefore = await harness.commit(
          tx => tx.scanEntries({ conversationId: parent.id }, 100),
          ctx
        )
        const reportsBefore = parentBefore.items.filter(
          entry =>
            UserEntry.is(entry) &&
            JSON.stringify(entry.model).includes(
              '[subagent worker answered, no reply needed] answer'
            )
        )
        assert.equal(
          reportsBefore.length,
          phase === 'report' ? expected : expected - 1,
          'parent report commits before the terminal checkpoint, not before deliver checkpoint'
        )
        interrupt = false
        await harness.close(ctx)
        harness = await Harness.open(
          await openNodeSqliteStorage(path),
          options,
          ctx
        )
        const settled = await harness.waitForTask(reporter.id, ctx)
        await harness.waitForIdle(ctx)
        assert.equal(settled.state.outcome.status, 'completed')
        const after = await harness.commit(
          tx => tx.scanTasks({ kind: definition.name }, 100),
          ctx
        )
        assert.equal(after.items.length, expected)
        for (const task of after.items) {
          assert.equal(
            (await harness.waitForTask(task.id, ctx)).state.outcome.status,
            'completed'
          )
        }
        const childAfter = await harness.commit(
          tx => tx.scanEntries({ conversationId: child.id }, 100),
          ctx
        )
        assert.deepEqual(
          childAfter.items.filter(UserEntry.is).map(entry => entry.id),
          childBefore.items.filter(UserEntry.is).map(entry => entry.id),
          'replay does not add child inputs'
        )
        const parentAfter = await harness.commit(
          tx => tx.scanEntries({ conversationId: parent.id }, 100),
          ctx
        )
        assert.equal(
          parentAfter.items.filter(
            entry =>
              UserEntry.is(entry) &&
              JSON.stringify(entry.model).includes(
                '[subagent worker answered, no reply needed] answer'
              )
          ).length,
          expected,
          'exactly one parent report per command'
        )
      }
    } finally {
      await harness.close(ctx)
    }
  })
}
