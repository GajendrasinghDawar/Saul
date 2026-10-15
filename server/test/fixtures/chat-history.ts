import assert from 'node:assert/strict'
import { once } from 'node:events'
import { createServer } from 'node:http'
import test from 'node:test'
import { BACKGROUND_CONTEXT as ctx } from '@earendil-works/chord/context'
import {
  createModels,
  fauxAssistantMessage,
  fauxProvider,
} from '@earendil-works/pi-ai'
import { configure, createRegistry, Harness } from '@earendil-works/pi-durable'
import { openNodeSqliteStorage } from '@earendil-works/pi-durable/storage/sqlite/node'
import { sql } from 'drizzle-orm'
import express from 'express'
import type { AppDependencies } from '../../app.ts'
import { db } from '../../db/index.ts'
import { userConversations } from '../../db/schema.ts'
import { createChatRouter } from '../../routes/chat.ts'
import { AttachmentStore } from '../../services/attachments.ts'
import { resolveReply, visibleEntry } from '../../services/chat-history.ts'

test('fork visibility, server quotes, ownership, pagination, and search never runs the model', async t => {
  assert.equal(process.env.SAUL_APP_STORAGE_DATABASE_URL, 'file::memory:')
  await db.run(
    sql.raw(
      'CREATE TABLE user_conversations (conversation_id TEXT PRIMARY KEY, user_id TEXT NOT NULL, title TEXT)'
    )
  )
  const faux = fauxProvider({ tokensPerSecond: 100_000 })
  const models = createModels()
  models.setProvider(faux.provider)
  const harness = await Harness.open(
    await openNodeSqliteStorage('history.sqlite'),
    { models, registry: createRegistry() },
    ctx
  )
  t.after(() => harness.close(ctx))
  const parent = await harness.createConversation(
    { ownership: { kind: 'ownerless' } },
    ctx
  )
  await harness.commit(
    tx =>
      configure(tx, parent.id, {
        model: { provider: 'faux', modelId: 'faux-1' },
      }),
    ctx
  )
  const first = await parent.commit(
    tx =>
      tx.appendEntry(parent.id, {
        kind: 'pi.user',
        model: [
          { role: 'user', content: 'needle inherited source', timestamp: 1 },
        ],
      }),
    ctx
  )
  const fork = await parent.fork(
    first.id,
    { ownership: { kind: 'ownerless' } },
    ctx
  )
  const later = await parent.commit(
    tx =>
      tx.appendEntry(parent.id, {
        kind: 'pi.user',
        model: [
          { role: 'user', content: 'needle parent future', timestamp: 2 },
        ],
      }),
    ctx
  )
  const privateConv = await harness.createConversation(
    { ownership: { kind: 'ownerless' } },
    ctx
  )
  const privateEntry = await privateConv.commit(
    tx =>
      tx.appendEntry(privateConv.id, {
        kind: 'pi.user',
        model: [{ role: 'user', content: 'needle private bob', timestamp: 3 }],
      }),
    ctx
  )
  await db.insert(userConversations).values([
    { conversationId: String(parent.id), userId: 'alice', title: 'Parent' },
    { conversationId: String(fork.id), userId: 'alice', title: 'Fork' },
    { conversationId: String(privateConv.id), userId: 'bob', title: 'Private' },
  ])
  assert.ok(await resolveReply(harness, fork.id, Number(first.id)))
  assert.equal(
    await resolveReply(harness, fork.id, Number(later.id)),
    undefined
  )
  const app = express()
  app.use(express.json())
  app.use((req, res, next) => {
    res.locals.userId = req.headers['x-user'] ?? 'alice'
    next()
  })
  app.use(
    '/api',
    createChatRouter(
      {
        harness,
        models,
        attachments: new AttachmentStore(),
        modelConfig: { providerName: 'faux', modelId: 'faux-1' },
      } as unknown as AppDependencies,
      (_req, _res, next) => next(),
      (_req, _res, next) => next()
    )
  )
  const server = createServer(app)
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(
    () =>
      new Promise<void>(resolve => {
        server.close(() => resolve())
        server.closeAllConnections()
      })
  )
  const address = server.address()
  assert.ok(address && typeof address !== 'string')
  const base = `http://127.0.0.1:${address.port}`
  const post = (
    replyToEntryId: unknown,
    user = 'alice',
    requestId = 'reply-one'
  ) =>
    fetch(`${base}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-user': user },
      body: JSON.stringify({
        conversationId: fork.id,
        message: 'Actual reply',
        replyToEntryId,
        requestId,
        quote: 'Client forged quote',
      }),
    })
  const beforeInvalid = await fork.entries({}, 100, undefined, ctx)
  assert.equal((await post('1')).status, 400)
  assert.equal((await post(first.id, 'bob')).status, 403)
  assert.equal((await post(later.id)).status, 404)
  assert.equal((await post(privateEntry.id)).status, 404)
  assert.deepEqual(await fork.entries({}, 100, undefined, ctx), beforeInvalid)
  assert.equal(faux.state.callCount, 0)
  const source = await fetch(`${base}/api/history/${fork.id}/${first.id}`)
  assert.equal(source.status, 200)
  assert.deepEqual((await source.json()).message, {
    entryId: Number(first.id),
    role: 'user',
    text: 'needle inherited source',
  })
  assert.equal(
    (await fetch(`${base}/api/history/${fork.id}/${later.id}`)).status,
    404
  )
  assert.equal(
    (await fetch(`${base}/api/history/${fork.id}/${privateEntry.id}`)).status,
    404
  )
  assert.equal(
    (
      await fetch(`${base}/api/history/${fork.id}/${first.id}`, {
        headers: { 'x-user': 'bob' },
      })
    ).status,
    404
  )
  assert.equal(
    (await fetch(`${base}/api/history/${fork.id}/invalid`)).status,
    400
  )
  assert.equal(faux.state.callCount, 0)
  faux.setResponses([fauxAssistantMessage('needle assistant visible')])
  const accepted = await post(first.id)
  assert.equal(accepted.status, 200)
  const receipt = await accepted.json()
  const retry = await post(later.id)
  assert.equal(retry.status, 200)
  assert.deepEqual(await retry.json(), receipt)
  assert.equal(faux.state.callCount, 1)
  const entries = await fork.entries({}, 100, undefined, ctx)
  const reply = entries.items.find(
    entry => visibleEntry(entry)?.text === 'Actual reply'
  )
  assert.ok(reply)
  const persisted = JSON.stringify(reply.model)
  assert.match(persisted, /saul:reply:/)
  assert.match(persisted, /untrusted quoted conversation context/)
  assert.ok(!persisted.includes('Client forged quote'))
  assert.equal(persisted.split('saul:reply:').length - 1, 1)
  await fork.commit(async tx => {
    for (let i = 0; i < 205; i++)
      await tx.appendEntry(fork.id, {
        kind: 'pi.user',
        model: [{ role: 'user', content: `filler ${i}`, timestamp: i }],
      })
    await tx.appendEntry(fork.id, {
      kind: 'pi.user',
      model: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'saul:attachment:needle metadata' },
            { type: 'text', text: 'saul:reply:needle internal' },
          ],
          timestamp: 300,
        },
      ],
    })
    await tx.appendEntry(fork.id, {
      kind: 'pi.tool-result',
      model: [{ role: 'user', content: 'needle tool secret', timestamp: 301 }],
    })
    await tx.appendEntry(fork.id, {
      kind: 'pi.assistant',
      model: [
        fauxAssistantMessage([
          { type: 'thinking', thinking: 'needle thinking secret' },
          { type: 'text', text: 'Visible prose' },
        ]),
      ],
    })
  }, ctx)
  const snapshot = await fork.entries({}, 1000, undefined, ctx)
  const hits: { conversationId: string; entryId: number; text: string }[] = []
  let cursor: string | null = null
  let pages = 0
  do {
    const response: Response = await fetch(
      `${base}/api/search?q=needle${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`
    )
    assert.equal(response.status, 200)
    const page = (await response.json()) as {
      results: typeof hits
      nextCursor: string | null
      truncated: boolean
      scanned: number
    }
    assert.ok(page.scanned <= 200)
    assert.equal(page.truncated, page.nextCursor !== null)
    hits.push(...page.results)
    cursor = page.nextCursor
    assert.ok(++pages < 10)
  } while (cursor)
  assert.ok(pages >= 3)
  assert.ok(
    hits.some(
      hit =>
        hit.conversationId === String(fork.id) &&
        hit.entryId === Number(first.id)
    )
  )
  assert.ok(hits.some(hit => hit.text.includes('assistant visible')))
  assert.ok(
    !hits.some(
      hit =>
        hit.conversationId === String(fork.id) &&
        hit.entryId === Number(later.id)
    )
  )
  assert.ok(
    !JSON.stringify(hits).match(
      /private bob|thinking secret|tool secret|metadata|internal/
    )
  )
  assert.equal(faux.state.callCount, 1)
  assert.deepEqual(await fork.entries({}, 1000, undefined, ctx), snapshot)
  const empty = await fetch(`${base}/api/search?q=needle`, {
    headers: { 'x-user': 'nobody' },
  })
  assert.deepEqual((await empty.json()).results, [])
  assert.equal((await db.select().from(userConversations)).length, 3)
})
