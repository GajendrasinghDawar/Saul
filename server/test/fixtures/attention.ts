import assert from 'node:assert/strict'
import test from 'node:test'
import { BACKGROUND_CONTEXT as ctx } from '@earendil-works/chord/context'
import { createModels } from '@earendil-works/pi-ai'
import {
  createRegistry,
  defineExtension,
  defineTask,
  Harness,
} from '@earendil-works/pi-durable'
import { openNodeSqliteStorage } from '@earendil-works/pi-durable/storage/sqlite/node'
import { sql } from 'drizzle-orm'
import { db } from '../../db/index.ts'
import { approvals, userConversations } from '../../db/schema.ts'
import { TaskService } from '../../services/tasks.ts'

test('attention includes owned signals beyond the first task page without completed-tool noise', async () => {
  assert.equal(process.env.TURSO_DATABASE_URL, 'file::memory:')
  await db.run(
    sql.raw(
      'CREATE TABLE user_conversations (conversation_id TEXT PRIMARY KEY, user_id TEXT NOT NULL, title TEXT)'
    )
  )
  await db.run(
    sql.raw(
      'CREATE TABLE approvals (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, action TEXT NOT NULL, detail TEXT, status TEXT NOT NULL)'
    )
  )
  const makeTask = (name: string) =>
    defineTask<
      { message: string; at: number; fail?: boolean },
      { phase: 'finish' },
      null
    >({
      name,
      version: 1,
      initial: () => ({ phase: 'finish' }),
      phases: {
        finish: (task, runtime, context) =>
          runtime.commit(
            () => ({
              status: 'terminal',
              outcome: task.input.fail
                ? {
                    status: 'failed',
                    error: { message: 'token=never-display-this' },
                  }
                : { status: 'completed', result: null },
            }),
            context
          ),
      },
      abort: (_task, runtime, context) =>
        runtime.commit(
          () => ({ status: 'terminal', outcome: { status: 'aborted' } }),
          context
        ),
    })
  const reminder = makeTask('lali.reminder')
  const reporter = makeTask('lali.subagent-reporter')
  const noise = makeTask('fixture.noise')
  const registry = createRegistry()
  registry.install(
    defineExtension({
      name: 'attention-fixture',
      tasks: [reminder, reporter, noise],
    })
  )
  const harness = await Harness.open(
    await openNodeSqliteStorage('attention.sqlite'),
    { models: createModels(), registry },
    ctx
  )
  try {
    const alice = await harness.createConversation(
      { ownership: { kind: 'ownerless' } },
      ctx
    )
    const bob = await harness.createConversation(
      { ownership: { kind: 'ownerless' } },
      ctx
    )
    await db.insert(userConversations).values([
      { userId: 'alice', conversationId: String(alice.id) },
      { userId: 'bob', conversationId: String(bob.id) },
    ])
    await db.insert(approvals).values([
      {
        id: 'alice-pending',
        userId: 'alice',
        action: `clear_todos:${alice.id}`,
        detail: 'Permission',
        status: 'pending',
      },
      {
        id: 'alice-consumed',
        userId: 'alice',
        action: `clear_todos:${alice.id}`,
        detail: 'Old',
        status: 'consumed',
      },
      {
        id: 'bob-private',
        userId: 'bob',
        action: `clear_todos:${bob.id}`,
        detail: 'Private',
        status: 'pending',
      },
    ])
    const created = await harness.commit(async tx => {
      const options = {
        conversationId: alice.id,
        ownership: { kind: 'conversation' as const },
        background: true,
      }
      for (let i = 0; i < 105; i++)
        await tx.createTask(noise, { message: `Noise ${i}`, at: 0 }, options)
      const due = await tx.createTask(
        reminder,
        { message: 'Apply for the role', at: Date.now() - 1000 },
        options
      )
      await tx.createTask(
        reminder,
        { message: 'Not due', at: Date.now() + 100000 },
        options
      )
      await tx.createTask(
        reminder,
        { message: 'Private reminder', at: 0 },
        { ...options, conversationId: bob.id }
      )
      const failed = await tx.createTask(
        noise,
        { message: 'Private input', at: 0, fail: true },
        options
      )
      const report = await tx.createTask(
        reporter,
        { message: 'Report', at: 0 },
        options
      )
      const emptyReporter = await tx.createTask(
        reporter,
        { message: 'No report', at: 0 },
        options
      )
      return { due, failed, report, emptyReporter }
    }, ctx)
    await harness.waitForTask(created.emptyReporter, ctx)
    await harness.waitForTask(created.due, ctx)
    await harness.waitForTask(created.failed, ctx)
    await harness.waitForTask(created.report, ctx)
    const source = await alice.submit(
      {
        type: 'write',
        requestId: `subagent-report:${created.report}`,
        entry: {
          kind: 'pi.user',
          model: [
            {
              role: 'user',
              content: 'Completed delegated report',
              timestamp: Date.now(),
            },
          ],
        },
      },
      ctx
    )
    const receipt = await source.wait(ctx)
    const service = new TaskService(harness)
    const before = (await harness.inspect(ctx)).tasks
    const inbox = await service.getAttention('alice')
    assert.deepEqual(
      inbox.groups.approvals.map(item => item.approvalId),
      ['alice-pending']
    )
    assert.deepEqual(
      inbox.groups.reminders.map(item => item.text),
      ['Apply for the role']
    )
    assert.deepEqual(
      inbox.groups.failures.map(item => item.id),
      [`task:${created.failed}`]
    )
    assert.deepEqual(
      inbox.groups.results.map(item => item.id),
      [`task:${created.report}`]
    )
    assert.equal(inbox.groups.results[0].source?.entryId, String(receipt.entry))
    assert.ok(!JSON.stringify(inbox).includes('never-display-this'))
    assert.ok(!JSON.stringify(inbox).includes('Private'))
    assert.deepEqual(
      (await harness.inspect(ctx)).tasks,
      before,
      'viewing attention must not run more work'
    )
    assert.ok((await service.getUserTasks('alice')).length > 100)
    assert.deepEqual((await service.getAttention('nobody')).groups, {
      approvals: [],
      reminders: [],
      failures: [],
      results: [],
    })
  } finally {
    await harness.close(ctx)
  }
})
