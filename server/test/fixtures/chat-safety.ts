import assert from 'node:assert/strict'
import { once } from 'node:events'
import { createServer } from 'node:http'
import test from 'node:test'
import { BACKGROUND_CONTEXT as ctx } from '@earendil-works/chord/context'
import {
  createModels,
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from '@earendil-works/pi-ai'
import { eq, sql } from 'drizzle-orm'
import express from 'express'
import { clearTodos, requestTodoClear, saveTodo } from '../../agent/data.ts'
import type { AppDependencies } from '../../app.ts'
import { db } from '../../db/index.ts'
import { approvals, todos, userConversations } from '../../db/schema.ts'
import { requestLogging } from '../../middleware/logging.ts'
import { createChatRouter } from '../../routes/chat.ts'
import { createTasksRouter } from '../../routes/tasks.ts'
import { AttachmentStore } from '../../services/attachments.ts'
import { ChatService } from '../../services/chat.ts'
import { setupDurableHarness } from '../../setup/durable.ts'

test('retry after restart admits one turn; forks and approvals enforce ownership', async t => {
  const logs: string[] = []
  for (const level of ['info', 'warn', 'error'] as const) {
    t.mock.method(console, level, (line: string) => logs.push(line))
  }
  assert.equal(process.env.SAUL_APP_STORAGE_DATABASE_URL, 'file::memory:')
  for (const statement of [
    'CREATE TABLE user_conversations (conversation_id TEXT PRIMARY KEY, user_id TEXT NOT NULL, title TEXT)',
    "CREATE TABLE approvals (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, action TEXT NOT NULL, detail TEXT, status TEXT NOT NULL DEFAULT 'pending')",
    "CREATE TABLE todos (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, title TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)",
  ])
    await db.run(sql.raw(statement))

  const faux = fauxProvider({ tokensPerSecond: 100_000 })
  const models = createModels()
  models.setProvider(faux.provider)
  const open = () => setupDurableHarness(models, new AttachmentStore())
  let harness = await open()
  const service = new ChatService(harness, () => ({
    provider: 'faux',
    modelId: 'faux-1',
  }))
  const conversationId = await service.createConversation('alice')
  faux.setResponses([fauxAssistantMessage('First answer')])
  const first = await service.submitMessage(
    conversationId,
    'Again',
    'reject',
    [],
    'retry-one'
  )
  assert.ok(first)
  await harness.close(ctx)
  harness = await open()

  // Only these routers are under test; authentication is a fixture identity.
  const dependencies = {
    harness,
    models,
    attachments: new AttachmentStore(),
    ai: {
      newConversationModel: async () => ({
        provider: 'faux',
        modelId: 'faux-1',
      }),
    },
  } as unknown as AppDependencies
  const app = express()
  app.use(requestLogging)
  app.use(express.json())
  app.use((req, res, next) => {
    res.locals.userId = req.headers['x-test-user'] ?? 'alice'
    next()
  })
  app.use(
    '/api',
    createChatRouter(
      dependencies,
      (_req, _res, next) => next(),
      (_req, _res, next) => next()
    )
  )
  app.use('/api/tasks', createTasksRouter(dependencies))
  const server = createServer(app)
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  assert.ok(address && typeof address !== 'string')
  const base = `http://127.0.0.1:${address.port}`
  const post = (path: string, body: unknown, user = 'alice') =>
    fetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-test-user': user },
      body: JSON.stringify(body),
    })
  const send = (requestId: string) =>
    post('/api/chat', {
      conversationId,
      message: 'Again',
      whenBusy: 'reject',
      requestId,
    })
  try {
    assert.equal((await send('retry-one')).status, 200)
    const conversation = await harness.conversation(conversationId, ctx)
    assert.ok(conversation)
    let entries = await conversation.entries({}, 100, undefined, ctx)
    assert.equal(
      entries.items.filter(entry => entry.kind === 'pi.user').length,
      1
    )
    assert.equal(faux.state.callCount, 1)
    faux.appendResponses([fauxAssistantMessage('Second answer')])
    const concurrent = await Promise.all([send('retry-two'), send('retry-two')])
    assert.deepEqual(
      concurrent.map(response => response.status),
      [200, 200]
    )
    entries = await conversation.entries({}, 100, undefined, ctx)
    const users = entries.items.filter(entry => entry.kind === 'pi.user')
    assert.equal(users.length, 2)
    assert.equal(faux.state.callCount, 2)
    assert.equal((await send('invalid id')).status, 400)
    assert.equal(
      (
        await post(
          '/api/chat',
          { conversationId, message: 'Again', requestId: 'retry-one' },
          'bob'
        )
      ).status,
      403
    )
    assert.equal(
      (await post(`/api/fork/${users[0].id}`, {}, 'bob')).status,
      403
    )
    assert.equal((await db.select().from(userConversations)).length, 1)
    const conversations = await harness.commit(
      tx => tx.scanConversations({}, 100),
      ctx
    )
    assert.equal(conversations.items.length, 1)
    assert.equal((await post(`/api/fork/${users[0].id}`, {})).status, 200)

    await saveTodo('alice-first', 'alice', 'Apply for a job')
    await saveTodo('bob-first', 'bob', 'Private task')
    faux.appendResponses([
      fauxAssistantMessage(fauxToolCall('clear_todos', {}), {
        stopReason: 'toolUse',
      }),
      fauxAssistantMessage('Waiting for your decision'),
    ])
    const freshService = new ChatService(harness, () => ({
      provider: 'faux',
      modelId: 'faux-1',
    }))
    await freshService.submitMessage(
      conversationId,
      'Clear todos',
      'reject',
      [],
      'clear-one'
    )
    const [proposal] = await db.select().from(approvals)
    assert.ok(proposal)
    assert.equal(proposal.status, 'pending')
    assert.equal(
      (await db.select().from(todos).where(eq(todos.id, 'alice-first')))[0]
        .status,
      'pending'
    )
    const path = `/api/tasks/approvals/${proposal.id}`
    assert.equal(
      (await fetch(`${base}${path}`, { headers: { 'x-test-user': 'bob' } }))
        .status,
      404
    )
    assert.equal((await post(`${path}/approve`, {}, 'bob')).status, 404)
    const decisions = await Promise.all([
      post(`${path}/approve`, {}),
      post(`${path}/reject`, {}),
    ])
    assert.deepEqual(
      decisions.map(response => response.status).sort(),
      [200, 409]
    )
    const decision = (
      await db.select().from(approvals).where(eq(approvals.id, proposal.id))
    )[0].status
    if (decision === 'rejected') {
      const next = await requestTodoClear('alice', String(conversationId))
      assert.equal(
        (await post(`/api/tasks/approvals/${next.id}/approve`, {})).status,
        200
      )
    }
    const approved = await requestTodoClear('alice', String(conversationId))
    await assert.rejects(
      clearTodos('alice', 'another-conversation', approved.id)
    )
    faux.appendResponses([
      fauxAssistantMessage(fauxToolCall('clear_todos', {}), {
        stopReason: 'toolUse',
      }),
      fauxAssistantMessage('Todos cleared'),
    ])
    await freshService.submitMessage(
      conversationId,
      'Proceed with the approved clear',
      'reject',
      [],
      'clear-two'
    )
    assert.equal(
      (await db.select().from(todos).where(eq(todos.id, 'alice-first')))[0]
        .status,
      'completed'
    )
    assert.equal(
      (await db.select().from(todos).where(eq(todos.id, 'bob-first')))[0]
        .status,
      'pending'
    )
    const consumed = await fetch(
      `${base}/api/tasks/approvals/${approved.id}`
    ).then(response => response.json())
    assert.equal(consumed.approval.status, 'consumed')
    await saveTodo('alice-later', 'alice', 'New task after completion')
    // Recovery of the same effect must not clear the later task.
    await clearTodos('alice', String(conversationId), approved.id)
    assert.equal(
      (await db.select().from(todos).where(eq(todos.id, 'alice-later')))[0]
        .status,
      'pending'
    )
    assert.equal(
      (await post(`/api/tasks/approvals/${approved.id}/approve`, {})).status,
      409
    )
    const next = await requestTodoClear('alice', String(conversationId))
    assert.notEqual(next.id, approved.id)
    assert.equal(next.status, 'pending')

    // A provider failure settles normally in Pi. It must still reach the
    // console, without disclosing prompts, credentials, or raw provider errors.
    const privateValue = 'PRIVATE-LOG-CANARY'
    faux.appendResponses([
      fauxAssistantMessage('', {
        stopReason: 'error',
        errorMessage: `401 invalid subscription key: ${privateValue}`,
      }),
    ])
    const failedResponse = await post(`/api/chat?token=${privateValue}`, {
      conversationId,
      message: privateValue,
      requestId: 'provider-error',
    })
    assert.equal(failedResponse.status, 200)
    const records: {
      event: string
      category?: string
      level: string
      conversationId?: number
      requestId?: string
      status?: number
      route?: string
      durationMs?: number
    }[] = logs.map(line => JSON.parse(line))
    const failure = records.find(
      record => record.event === 'agent.response_failed'
    )
    assert.ok(failure)
    assert.equal(failure.level, 'error')
    assert.equal(failure.category, 'authentication')
    assert.equal(failure.conversationId, conversationId)
    const request = records.find(
      record => record.requestId === failedResponse.headers.get('x-request-id')
    )
    assert.ok(request)
    assert.equal(request.status, 200)
    assert.equal(request.route, '/chat')
    assert.equal(typeof request.durationMs, 'number')
    assert.ok(
      records.some(
        record =>
          record.event === 'http.request' &&
          record.status === 403 &&
          record.level === 'warn'
      )
    )
    assert.ok(records.some(record => record.event === 'agent.response'))
    assert.ok(records.some(record => record.event === 'agent.tool_result'))
    assert.ok(!logs.join('\n').includes(privateValue))
  } finally {
    server.closeAllConnections()
    await new Promise<void>(resolve => server.close(() => resolve()))
    await harness.close(ctx)
  }
})
