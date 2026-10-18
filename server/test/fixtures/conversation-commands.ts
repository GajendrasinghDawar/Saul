import assert from 'node:assert/strict'
import { once } from 'node:events'
import test from 'node:test'
import type { Context } from '@earendil-works/chord'
import { BACKGROUND_CONTEXT as ctx } from '@earendil-works/chord/context'
import {
  createModels,
  fauxAssistantMessage,
  fauxProvider,
} from '@earendil-works/pi-ai'
import {
  configure,
  createRegistry,
  Harness,
  MemoryStorage,
  type Tx,
} from '@earendil-works/pi-durable'
import { openNodeSqliteStorage } from '@earendil-works/pi-durable/storage/sqlite/node'
import express from 'express'
import { deleteUserConversation } from '../../agent/data.ts'
import {
  ReminderTask,
  ResendNotificationGateway,
  setNotificationService,
} from '../../agent/reminders.ts'
import { type AppDependencies, createApp } from '../../app.ts'
import { db, migrateAppDatabase } from '../../db/index.ts'
import { userConversations } from '../../db/schema.ts'
import { createChatRouter } from '../../routes/chat.ts'
import { createTasksRouter } from '../../routes/tasks.ts'
import { AttachmentStore } from '../../services/attachments.ts'
import { ChatService } from '../../services/chat.ts'
import { setupDurableHarness } from '../../setup/durable.ts'
import { durableStorageConfig } from '../../storage/config.ts'
import { openLibsqlStorage } from '../../storage/libsql.ts'

test('commands reuse durable receipts across restart and ownership write failures', async t => {
  await migrateAppDatabase()
  const models = createModels()
  const faux = fauxProvider({ tokensPerSecond: 100_000 })
  models.setProvider(faux.provider)
  const legacyStorage = durableStorageConfig.url
    ? await openLibsqlStorage(durableStorageConfig.url)
    : await openNodeSqliteStorage(durableStorageConfig.localPath)
  const legacy = await Harness.open(
    legacyStorage,
    { models, registry: createRegistry() },
    ctx
  )
  const legacyConversation = await legacy.createConversation(
    { ownership: { kind: 'ownerless' } },
    ctx
  )
  await legacy.commit(
    tx =>
      configure(tx, legacyConversation.id, {
        model: { provider: 'azure-openai-responses', modelId: 'gpt-4.1' },
      }),
    ctx
  )
  await legacy.close(ctx)
  let harness = await setupDurableHarness(models, new AttachmentStore())
  const migrated = await harness.conversation(legacyConversation.id, ctx)
  assert.ok(migrated)
  assert.deepEqual((await migrated.agent(ctx)).model, {
    provider: 'azure',
    modelId: 'gpt-4.1',
  })
  let modelAvailable = true
  const defaultModel = async () =>
    modelAvailable ? { provider: 'faux', modelId: 'faux-1' } : null
  let service = new ChatService(harness, defaultModel)
  const parent = await service.createConversation('alice')
  faux.setResponses([fauxAssistantMessage('Saved answer')])
  await service.submitMessage(parent, 'A message to fork', 'followUp')
  const parentConversation = await harness.conversation(parent, ctx)
  assert.ok(parentConversation)
  const entries = await parentConversation.entries({}, 100, undefined, ctx)
  const entry = entries.items.find(item => item.kind === 'pi.user')
  assert.ok(entry)
  const dependencies = () =>
    ({
      harness,
      models,
      attachments: new AttachmentStore(),
      ai: { newConversationModel: defaultModel },
    }) as unknown as AppDependencies
  let app = express()
  const serve = () => {
    app = express()
    app.use(express.json())
    app.use((req, res, next) => {
      res.locals.userId = req.headers['x-test-user'] ?? 'alice'
      next()
    })
    app.use(
      '/api',
      createChatRouter(
        dependencies(),
        (_req, _res, next) => next(),
        (_req, _res, next) => next()
      )
    )
    return app.listen(0, '127.0.0.1')
  }
  let server = serve()
  await once(server, 'listening')
  const post = (path: string, requestId: string, user = 'alice') => {
    const address = server.address()
    assert.ok(address && typeof address !== 'string')
    return fetch(`http://127.0.0.1:${address.port}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-test-user': user },
      body: JSON.stringify({ requestId }),
    })
  }
  try {
    const creates = await Promise.all([
      post('/api/new-thread', 'create-one'),
      post('/api/new-thread', 'create-one'),
    ])
    assert.deepEqual(
      creates.map(response => response.status),
      [200, 200]
    )
    const created = await creates[0].json()
    assert.equal(
      (await creates[1].json()).conversationId,
      created.conversationId
    )
    assert.equal((await db.select().from(userConversations)).length, 2)
    const fork = await (await post(`/api/fork/${entry.id}`, 'fork-one')).json()
    assert.ok(fork.newConversationId)
    assert.equal(
      (await post(`/api/fork/${entry.id}`, 'fork-one', 'bob')).status,
      403
    )
    assert.equal(
      (await post(`/api/fork/${entry.id}`, 'create-one')).status,
      409
    )
    assert.equal((await post('/api/new-thread', 'bad key')).status, 400)
    const brokenInsert = t.mock.method(db, 'insert', () => {
      throw new Error('Database unavailable')
    })
    assert.equal((await post('/api/new-thread', 'recover-owner')).status, 500)
    brokenInsert.mock.restore()
    server.closeAllConnections()
    await new Promise<void>(resolve => server.close(() => resolve()))
    await harness.close(ctx)
    harness = await setupDurableHarness(models, new AttachmentStore())
    service = new ChatService(harness, defaultModel)
    modelAvailable = false
    server = serve()
    await once(server, 'listening')
    assert.equal(
      (await (await post('/api/new-thread', 'create-one')).json())
        .conversationId,
      created.conversationId
    )
    assert.equal(
      (await (await post(`/api/fork/${entry.id}`, 'fork-one')).json())
        .newConversationId,
      fork.newConversationId
    )
    const recovered = await post('/api/new-thread', 'recover-owner')
    assert.equal(recovered.status, 200)
    const recoveredId = (await recovered.json()).conversationId
    assert.ok(
      (await db.select().from(userConversations)).some(
        record =>
          record.conversationId === String(recoveredId) &&
          record.userId === 'alice'
      )
    )
    assert.equal((await db.select().from(userConversations)).length, 4)
    assert.equal(
      (await harness.commit(tx => tx.scanConversations({}, 100), ctx)).items
        .length,
      5
    )
    modelAvailable = true
    const bob = await (
      await post('/api/new-thread', 'create-one', 'bob')
    ).json()
    assert.notEqual(bob.conversationId, created.conversationId)

    // Hold a duplicate admission until the first publication has been deleted.
    const commit = harness.commit.bind(harness)
    const secondAdmitted = Promise.withResolvers<void>()
    const releaseDuplicate = Promise.withResolvers<void>()
    let admissions = 0
    const delayedCommit = t.mock.method(
      harness,
      'commit',
      async <T>(
        change: (tx: Tx) => T | Promise<T>,
        context: Context
      ): Promise<T> => {
        const result = await commit(change, context)
        if (
          result &&
          typeof result === 'object' &&
          'operation' in result &&
          result.operation === 'create'
        ) {
          if (++admissions === 1) await secondAdmitted.promise
          else {
            secondAdmitted.resolve()
            await releaseDuplicate.promise
          }
        }
        return result
      }
    )
    const first = service.createConversation('alice', 'delete-race')
    const delayed = service.createConversation('alice', 'delete-race')
    const deletedId = await first
    await deleteUserConversation(String(deletedId), 'alice')
    releaseDuplicate.resolve()
    await assert.rejects(delayed, /conversation was deleted/)
    delayedCommit.mock.restore()
    assert.ok(
      !(await db.select().from(userConversations)).some(
        row => row.conversationId === String(deletedId)
      )
    )
  } finally {
    server.closeAllConnections()
    await new Promise<void>(resolve => server.close(() => resolve()))
    await harness.close(ctx)
  }
})

test('scheduled work resumes on boot without an HTTP request', {
  timeout: 10_000,
}, async () => {
  const notifications: string[] = []
  setNotificationService({
    sendReminder: async id => {
      notifications.push(id)
    },
  })
  const faux = fauxProvider({ tokensPerSecond: 100_000 })
  faux.setResponses([fauxAssistantMessage('Reminder received after restart.')])
  const models = createModels()
  models.setProvider(faux.provider)
  let harness = await setupDurableHarness(models, new AttachmentStore())
  try {
    const conversationId = await new ChatService(harness, () => ({
      provider: 'faux',
      modelId: 'faux-1',
    })).createConversation('reminder-user')
    const taskId = await harness.commit(
      tx =>
        tx.createTask(
          ReminderTask,
          { message: 'restart reminder', at: Date.now() + 1_000 },
          {
            conversationId,
            ownership: { kind: 'conversation' },
            background: true,
          }
        ),
      ctx
    )
    await harness.close(ctx)
    assert.deepEqual(notifications, [])
    harness = await setupDurableHarness(models, new AttachmentStore())
    const settled = await harness.waitForTask(taskId, ctx)
    assert.equal(settled.state.outcome.status, 'completed')
    await harness.waitForIdle(ctx)
    assert.deepEqual(notifications, [String(taskId)])
    const conversation = await harness.conversation(conversationId, ctx)
    assert.ok(conversation)
    const entries = await conversation.entries({}, 100, undefined, ctx)
    assert.equal(
      entries.items.filter(entry => entry.kind === 'pi.user').length,
      1
    )
    assert.ok(
      JSON.stringify(entries.items).includes('Reminder received after restart.')
    )
  } finally {
    await harness.close(ctx)
    setNotificationService(ResendNotificationGateway)
  }
})

test('readiness rejects a closed or failed harness without exposing its error', async () => {
  class FaultStorage extends MemoryStorage {
    fail = false
    override commit(...args: Parameters<MemoryStorage['commit']>) {
      if (this.fail)
        return Promise.reject(new Error('secret-storage-credential'))
      return super.commit(...args)
    }
  }
  for (const failure of [false, true]) {
    const storage = new FaultStorage()
    const harness = await Harness.open(
      storage,
      { models: createModels(), registry: createRegistry() },
      ctx
    )
    const app = createApp({
      harness,
      auth: { handler: () => Response.json(null) },
      ai: {},
      attachments: {},
      models: createModels(),
    } as unknown as AppDependencies)
    const server = app.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const address = server.address()
    assert.ok(address && typeof address !== 'string')
    const base = `http://127.0.0.1:${address.port}`
    try {
      assert.equal((await fetch(`${base}/ready`)).status, 200)
      if (failure) {
        storage.fail = true
        await assert.rejects(
          harness.createConversation({ ownership: { kind: 'ownerless' } }, ctx)
        )
        assert.equal((await harness.closed).reason, 'failed')
      } else await harness.close(ctx)
      const response = await fetch(`${base}/ready`)
      assert.equal(response.status, 503)
      assert.doesNotMatch(await response.text(), /secret-storage-credential/)
      assert.equal((await fetch(`${base}/health`)).status, 200)
      assert.equal((await fetch(`${base}/api/tasks`)).status, 503)
    } finally {
      server.closeAllConnections()
      await new Promise<void>(resolve => server.close(() => resolve()))
      await harness.close(ctx)
    }
  }
})

test('task SSE pushes owned transitions and a fresh snapshot on reconnect', {
  timeout: 15_000,
}, async () => {
  const harness = await setupDurableHarness(
    createModels(),
    new AttachmentStore()
  )
  const service = new ChatService(harness, () => ({
    provider: 'faux',
    modelId: 'faux-1',
  }))
  const alice = await service.createConversation('stream-alice')
  const bob = await service.createConversation('stream-bob')
  const createReminder = (conversationId: typeof alice) =>
    harness.commit(
      tx =>
        tx.createTask(
          ReminderTask,
          { message: 'private-input-canary', at: Date.now() + 60_000 },
          {
            conversationId,
            ownership: { kind: 'conversation' },
            background: true,
          }
        ),
      ctx
    )
  const hidden = await createReminder(bob)
  const app = express()
  app.use((_req, res, next) => {
    res.locals.userId = 'stream-alice'
    next()
  })
  app.use('/api/tasks', createTasksRouter({ harness } as AppDependencies))
  const server = app.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  assert.ok(address && typeof address !== 'string')
  const base = `http://127.0.0.1:${address.port}`
  type DisplayTask = { id: number; state: { status: string } }
  const connect = async () => {
    const response = await fetch(`${base}/api/tasks/stream`, {
      signal: AbortSignal.timeout(10_000),
    })
    assert.equal(response.status, 200)
    assert.ok(response.body)
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    return {
      reader,
      next: async (matches: (tasks: DisplayTask[]) => boolean) => {
        for (;;) {
          const end = buffer.indexOf('\n\n')
          if (end >= 0) {
            const frame = buffer.slice(0, end)
            buffer = buffer.slice(end + 2)
            if (!frame.startsWith('data: ')) continue
            assert.doesNotMatch(
              frame,
              /private-input-canary|checkpoint|"input"|"result"/
            )
            const { tasks } = JSON.parse(frame.slice(6)) as {
              tasks: DisplayTask[]
            }
            assert.ok(tasks.every(task => task.id !== hidden))
            if (matches(tasks)) return tasks
            continue
          }
          const chunk = await reader.read()
          assert.equal(chunk.done, false, 'task stream remains connected')
          buffer += decoder.decode(chunk.value, { stream: true })
        }
      },
    }
  }
  try {
    const stream = await connect()
    await stream.next(tasks => tasks.length === 0)
    const taskId = await createReminder(alice)
    await stream.next(tasks =>
      tasks.some(task => task.id === taskId && task.state.status !== 'terminal')
    )
    assert.equal(
      (await fetch(`${base}/api/tasks/${taskId}/abort`, { method: 'POST' }))
        .status,
      200
    )
    await harness.waitForTask(taskId, ctx)
    await stream.next(tasks =>
      tasks.some(task => task.id === taskId && task.state.status === 'terminal')
    )
    await stream.reader.cancel()
    const reconnected = await connect()
    await reconnected.next(tasks =>
      tasks.some(task => task.id === taskId && task.state.status === 'terminal')
    )
    await reconnected.reader.cancel()
  } finally {
    server.closeAllConnections()
    await new Promise<void>(resolve => server.close(() => resolve()))
    await harness.close(ctx)
  }
})
