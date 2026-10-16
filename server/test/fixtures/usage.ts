import assert from 'node:assert/strict'
import { once } from 'node:events'
import test from 'node:test'
import { BACKGROUND_CONTEXT as ctx } from '@earendil-works/chord/context'
import { createModels, createProvider, type Usage } from '@earendil-works/pi-ai'
import { createRegistry, Harness, UsageDoc } from '@earendil-works/pi-durable'
import { openNodeSqliteStorage } from '@earendil-works/pi-durable/storage/sqlite/node'
import { createApp } from '../../app.ts'
import type { auth as authInstance } from '../../auth/auth.ts'
import { db } from '../../db/index.ts'
import { userConversations } from '../../db/schema.ts'
import { AiManager } from '../../services/ai.ts'
import { AttachmentStore } from '../../services/attachments.ts'
import type { UsageOverview } from '../../services/usage.ts'

const usage = (input: number, cost = 0): Usage => ({
  input,
  output: 2,
  cacheRead: 3,
  cacheWrite: 4,
  reasoning: 1,
  cacheWrite1h: 2,
  totalTokens: input + 9,
  cost: { input: cost, output: 0, cacheRead: 0, cacheWrite: 0, total: cost },
})

test('authenticated usage ledger excludes inherited and unowned spend', async () => {
  assert.equal(process.env.SAUL_APP_STORAGE_DATABASE_URL, 'file::memory:')
  const models = createModels()
  let executions = 0
  models.setProvider(
    createProvider({
      id: 'local',
      auth: { apiKey: { name: 'Unused', resolve: async () => undefined } },
      models: ['org/priced', 'free', 'zero-priced'].map(id => ({
        id,
        provider: 'local',
        name: id,
        api: 'openai-completions' as const,
        baseUrl: 'https://unused.invalid',
        reasoning: false,
        input: ['text' as const],
        cost: {
          input: id === 'free' ? 0 : 999,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
        },
        contextWindow: 1000,
        maxTokens: 100,
      })),
      api: {
        stream: () => {
          executions++
          throw new Error('Must not execute')
        },
        streamSimple: () => {
          executions++
          throw new Error('Must not execute')
        },
      },
    })
  )
  const harness = await Harness.open(
    await openNodeSqliteStorage('usage.sqlite'),
    { models, registry: createRegistry() },
    ctx
  )
  const auth = {
    api: {
      getSession: async ({ headers }: { headers: Headers }) => {
        const token = headers.get('authorization')
        const id = token?.startsWith('Bearer ')
          ? token.slice(7)
          : headers.get('cookie') === 'alice-cookie'
            ? 'alice'
            : null
        return id && ['alice', 'bob', 'empty', 'broken'].includes(id)
          ? { user: { id, role: 'user' } }
          : null
      },
    },
  } as unknown as typeof authInstance
  const server = createApp({
    harness,
    models,
    auth,
    ai: new AiManager(),
    attachments: new AttachmentStore(),
  }).listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  assert.ok(address && typeof address !== 'string')
  const url = `http://127.0.0.1:${address.port}/api/usage`
  const get = (user: string) =>
    fetch(url, { headers: { authorization: `Bearer ${user}` } })
  try {
    const parent = await harness.createConversation(
      { ownership: { kind: 'ownerless' } },
      ctx
    )
    const receipt = await (
      await parent.submit(
        {
          type: 'write',
          entry: {
            kind: 'pi.user',
            model: [
              { role: 'user', content: 'fork point', timestamp: Date.now() },
            ],
          },
        },
        ctx
      )
    ).wait(ctx)
    await harness.commit(async tx => {
      const ledger = await tx.doc(UsageDoc, parent.id)
      ledger.models['local/org/priced'] = usage(10, 0.25)
    }, ctx)
    assert.ok(receipt.entry)
    const fork = await parent.fork(
      receipt.entry,
      { ownership: { kind: 'ownerless' } },
      ctx
    )
    assert.deepEqual(
      (await harness.snapshot(UsageDoc, fork.id, ctx))?.models ?? {},
      {}
    )
    const bob = await harness.createConversation(
      { ownership: { kind: 'ownerless' } },
      ctx
    )
    const broken = await harness.createConversation(
      { ownership: { kind: 'ownerless' } },
      ctx
    )
    await harness.commit(async tx => {
      const ledger = await tx.doc(UsageDoc, fork.id)
      // Ledger-only spend represents compaction attempts, which have no assistant entry.
      ledger.models['local/org/priced'] = usage(20, 0.5)
      ledger.models['removed/model'] = usage(30, 0.75)
      ledger.models['local/free'] = usage(40)
      ledger.models['missing/model'] = usage(50)
      ledger.models['local/zero-priced'] = usage(0)
      const toolName = '__proto__'
      ledger.tools[toolName] = usage(900, 9)
      ;(await tx.doc(UsageDoc, bob.id)).models['private/model'] = usage(
        10000,
        100
      )
      ;(await tx.doc(UsageDoc, broken.id)).models['bad/model'] = {
        ...usage(1),
        input: -1,
      }
    }, ctx)
    await db.insert(userConversations).values([
      { userId: 'alice', conversationId: String(parent.id) },
      { userId: 'alice', conversationId: String(fork.id) },
      { userId: 'alice', conversationId: '999999' },
      { userId: 'bob', conversationId: String(bob.id) },
      { userId: 'broken', conversationId: String(broken.id) },
    ])
    // Exceed the native global scan page size; ownership reads must not be capped.
    for (let i = 0; i < 260; i++) {
      const conversation = await harness.createConversation(
        { ownership: { kind: 'ownerless' } },
        ctx
      )
      await db.insert(userConversations).values({
        userId: 'alice',
        conversationId: String(conversation.id),
      })
    }
    assert.equal((await fetch(url)).status, 401)
    assert.equal(
      (
        await fetch(url, {
          headers: { authorization: 'Bearer invalid', cookie: 'alice-cookie' },
        })
      ).status,
      401
    )
    const before = (await harness.inspect(ctx)).tasks
    const response = await get('alice')
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('cache-control'), 'no-store')
    const result: UsageOverview = await response.json()
    assert.deepEqual(
      Object.keys(result).sort(),
      [
        'generatedAt',
        'scope',
        'conversationCount',
        'totals',
        'models',
        'tools',
        'unknownPricingModels',
      ].sort()
    )
    assert.ok(Number.isFinite(Date.parse(result.generatedAt)))
    assert.equal(result.scope, 'owned-conversations')
    assert.equal(result.conversationCount, 262)
    assert.equal(result.totals.input, 150)
    assert.equal(result.totals.totalTokens, 204)
    assert.equal(result.totals.cost.total, 1.5)
    assert.equal(result.totals.reasoning, 6)
    assert.equal(result.totals.cacheWrite1h, 12)
    assert.equal(result.unknownPricingModels, 3)
    // Today's nonzero catalog price does not establish yesterday's recorded cost.
    assert.equal(
      result.models.find(model => model.key === 'local/zero-priced')
        ?.costStatus,
      'unknown'
    )
    assert.equal(
      result.models.find(model => model.key === 'local/org/priced')?.usage.cost
        .total,
      0.75
    )
    assert.equal(
      result.models.find(model => model.key === 'removed/model')?.costStatus,
      'estimated'
    )
    assert.deepEqual(result.tools, [
      { name: '__proto__', usage: usage(900, 9) },
    ])
    assert.ok(!JSON.stringify(result).includes('private/model'))
    assert.equal(
      (await (await fetch(url, { headers: { cookie: 'alice-cookie' } })).json())
        .totals.input,
      150
    )
    const empty: UsageOverview = await (await get('empty')).json()
    assert.equal(empty.conversationCount, 0)
    assert.equal(empty.totals.totalTokens, 0)
    assert.equal(empty.totals.cost.total, 0)
    assert.deepEqual(empty.models, [])
    assert.deepEqual(empty.tools, [])
    const failed = await get('broken')
    assert.equal(failed.status, 500)
    assert.equal(failed.headers.get('cache-control'), 'no-store')
    assert.deepEqual(await failed.json(), {
      error: 'Unable to load usage overview',
    })
    assert.equal(executions, 0)
    assert.deepEqual((await harness.inspect(ctx)).tasks, before)
  } finally {
    server.closeAllConnections()
    await new Promise<void>(resolve => server.close(() => resolve()))
    await harness.close(ctx)
  }
})
