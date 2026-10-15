import assert from 'node:assert/strict'
import { once } from 'node:events'
import { createServer } from 'node:http'
import test from 'node:test'
import { BACKGROUND_CONTEXT as ctx } from '@earendil-works/chord/context'
import cookieParser from 'cookie-parser'
import { eq } from 'drizzle-orm'
import express from 'express'
import { createApp } from '../../app.ts'
import type { auth as authInstance } from '../../auth/auth.ts'
import { db, migrateAppDatabase } from '../../db/index.ts'
import { secrets } from '../../db/schema.ts'
import { createAiRouter } from '../../routes/ai.ts'
import {
  decryptSetting,
  encryptSetting,
  getSecret,
} from '../../secretsManager.ts'
import { AiManager, EncryptedCredentialStore } from '../../services/ai.ts'
import { AiLogins } from '../../services/ai-logins.ts'
import { AttachmentStore } from '../../services/attachments.ts'
import { ChatService } from '../../services/chat.ts'
import { setupDurableHarness } from '../../setup/durable.ts'

test('AI persistence, native local generation, admin boundaries and live defaults', async () => {
  await migrateAppDatabase()
  await db.insert(secrets).values({
    name: 'AZURE_OPENAI_API_KEY',
    value: 'obsolete-corrupt-row',
    kind: 'secret',
    updatedAt: new Date(),
  })
  const ai = new AiManager()
  await ai.load()
  assert.equal(ai.getDefault(), null)
  assert.equal(getSecret('AZURE_OPENAI_API_KEY'), '')
  const fake = createServer(async (req, res) => {
    let body = ''
    for await (const chunk of req) body += chunk
    assert.equal(req.url, '/v1/chat/completions')
    assert.equal(JSON.parse(body).model, 'one')
    res.writeHead(200, { 'Content-Type': 'text/event-stream' })
    res.end(
      'data: {"id":"test","choices":[{"index":0,"delta":{"role":"assistant","content":"local answer"},"finish_reason":null}]}\n\ndata: {"choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n'
    )
  })
  fake.listen(0, '127.0.0.1')
  await once(fake, 'listening')
  const addr = fake.address()
  assert.ok(addr && typeof addr !== 'string')
  const definition = {
    name: 'Local test',
    api: 'openai-completions',
    baseUrl: `http://127.0.0.1:${addr.port}/v1`,
    keyless: true,
    models: ['one', 'two'].map(id => ({
      id,
      name: id,
      reasoning: false,
      input: id === 'two' ? ['text', 'image'] : ['text'],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 1024,
      maxTokens: 128,
      compat: {
        supportsStore: false,
        openRouterRouting: { only: ['example'] },
      },
      thinkingLevelMap: { high: null },
      inputLimits: { maxRequestBytes: 9000 },
      samplingParams: { top_p: 0.8 },
    })),
  }
  await ai.put('local', definition)
  const catalog = await ai.catalog('local')
  assert.deepEqual(catalog[0].thinkingLevelMap, { high: null })
  assert.deepEqual(catalog[0].inputLimits, { maxRequestBytes: 9000 })
  assert.deepEqual(catalog[0].samplingParams, { top_p: 0.8 })
  assert.deepEqual(catalog[0].compat, {
    supportsStore: false,
    openRouterRouting: { only: ['example'] },
  })
  await assert.rejects(ai.put('openai', definition))
  await assert.rejects(
    ai.put('local', {
      ...definition,
      baseUrl: 'https://user:secret@example.com',
    })
  )
  await assert.rejects(ai.setDefault({ provider: 'local', modelId: 'missing' }))
  await ai.setDefault({ provider: 'local', modelId: 'one' })
  const model = ai.models.getModel('local', 'one')
  assert.ok(model)
  try {
    const result = await ai.models.completeSimple(model, {
      messages: [{ role: 'user', content: 'hello', timestamp: Date.now() }],
    })
    assert.equal(result.stopReason, 'stop')
    assert.equal(
      result.content[0].type === 'text' ? result.content[0].text : null,
      'local answer'
    )
  } finally {
    fake.closeAllConnections()
    await new Promise<void>(resolve => fake.close(() => resolve()))
  }
  const reboot = new AiManager()
  await reboot.load()
  assert.deepEqual(reboot.getDefault(), ai.getDefault())
  assert.equal(reboot.getDeviceId(), ai.getDeviceId())
  assert.ok(reboot.models.getModel('local', 'two'))
  await assert.rejects(reboot.remove('local'))

  const store = new EncryptedCredentialStore()
  await store.load()
  await store.modify('local', async () => ({
    type: 'api_key',
    key: 'PRIVATE-CANARY',
  }))
  const order: string[] = []
  await Promise.all([
    store.modify('local', async current => {
      order.push('modify')
      assert.equal(current?.type, 'api_key')
      await new Promise(r => setTimeout(r, 20))
      return { type: 'api_key', key: 'ROTATED-CANARY' }
    }),
    store.delete('local').then(() => {
      order.push('delete')
    }),
  ])
  assert.deepEqual(order, ['modify', 'delete'])
  assert.equal(await store.read('local'), undefined)
  let release = () => {}
  const gate = new Promise<void>(resolve => {
    release = resolve
  })
  const slow = store.modify('slow', async () => {
    await gate
    return { type: 'api_key', key: 'slow-key' }
  })
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      store.modify('independent', async () => ({
        type: 'api_key',
        key: 'independent-key',
      })),
      new Promise((_, reject) => {
        timeout = setTimeout(
          () =>
            reject(
              new Error('Unrelated credential write blocked by slow refresh')
            ),
          1000
        )
      }),
    ])
    assert.deepEqual(await store.read('independent'), {
      type: 'api_key',
      key: 'independent-key',
    })
  } finally {
    clearTimeout(timeout)
    release()
    await slow
  }
  await store.modify('local', async () => ({
    type: 'api_key',
    key: 'PRIVATE-CANARY',
  }))
  const restored = new EncryptedCredentialStore()
  await restored.load()
  assert.deepEqual(await restored.read('local'), {
    type: 'api_key',
    key: 'PRIVATE-CANARY',
  })
  const row = (
    await db
      .select()
      .from(secrets)
      .where(eq(secrets.name, 'ai:credential:local'))
  )[0]
  assert.ok(!row.value.includes('PRIVATE-CANARY'))
  assert.throws(
    () => decryptSetting('different-name', row.value),
    /cannot be unlocked/
  )

  const oauthProvider = ai.models.getProvider('openai')
  assert.ok(oauthProvider?.auth.oauth)
  let refreshes = 0
  ai.models.setProvider({
    ...oauthProvider,
    auth: {
      oauth: {
        ...oauthProvider.auth.oauth,
        refresh: async c => {
          refreshes++
          await new Promise(r => setTimeout(r, 20))
          return {
            ...c,
            access: 'rotated-access',
            refresh: 'rotated-refresh',
            expires: Date.now() + 3600000,
          }
        },
        toAuth: async c => ({ apiKey: c.access }),
      },
    },
  })
  await ai.credentials.modify('openai', async () => ({
    type: 'oauth',
    access: 'expired',
    refresh: 'initial-refresh',
    expires: 1,
  }))
  const authResults = await Promise.all([
    ai.models.getAuth('openai'),
    ai.models.getAuth('openai'),
  ])
  assert.equal(refreshes, 1)
  assert.ok(authResults.every(r => r?.auth.apiKey === 'rotated-access'))
  const refreshedStore = new EncryptedCredentialStore()
  await refreshedStore.load()
  const refreshed = await refreshedStore.read('openai')
  assert.ok(
    refreshed?.type === 'oauth' && refreshed.refresh === 'rotated-refresh'
  )
  await ai.models.logout('openai')
  ai.models.setProvider(oauthProvider)

  const logins = new AiLogins(ai)
  try {
    const state = logins.start('openai', 'api_key', 'admin')
    await new Promise(r => setTimeout(r, 10))
    const pending = logins.get(state.id, 'admin')
    assert.ok(pending.prompt)
    assert.ok(!('signal' in pending.prompt))
    assert.throws(() => logins.get(state.id, 'other'))
    assert.throws(() =>
      logins.answer(state.id, 'admin', 'wrong-id', 'PRIVATE-CANARY')
    )
    logins.cancel(state.id, 'admin')
    assert.equal(logins.get(state.id, 'admin').status, 'cancelled')
    assert.throws(() =>
      logins.answer(state.id, 'admin', pending.prompt?.id, 'PRIVATE-CANARY')
    )
    const success = logins.start('openai', 'api_key', 'admin')
    await new Promise(r => setTimeout(r, 10))
    logins.answer(
      success.id,
      'admin',
      logins.get(success.id, 'admin').prompt?.id,
      'PRIVATE-CANARY'
    )
    await new Promise(r => setTimeout(r, 30))
    assert.equal(logins.get(success.id, 'admin').status, 'complete')
    assert.ok(
      !JSON.stringify(logins.get(success.id, 'admin')).includes(
        'PRIVATE-CANARY'
      )
    )
    const builtin = ai.models.getProvider('openai')
    assert.ok(builtin?.auth.apiKey)
    const promptAbort = new AbortController()
    ai.models.setProvider({
      ...builtin,
      auth: {
        apiKey: {
          ...builtin.auth.apiKey,
          login: async interaction => {
            await interaction.prompt({
              type: 'manual_code',
              message: 'Manual callback',
              signal: promptAbort.signal,
            })
            return { type: 'api_key', key: 'NEVER-SAVED' }
          },
        },
      },
    })
    const cancelledPrompt = logins.start('openai', 'api_key', 'admin')
    await new Promise(r => setTimeout(r, 10))
    const promptId = logins.get(cancelledPrompt.id, 'admin').prompt?.id
    promptAbort.abort()
    await new Promise(r => setTimeout(r, 10))
    assert.equal(logins.get(cancelledPrompt.id, 'admin').prompt, undefined)
    assert.throws(() =>
      logins.answer(cancelledPrompt.id, 'admin', promptId, 'not-accepted')
    )
    assert.equal(logins.get(cancelledPrompt.id, 'admin').status, 'error')
    ai.models.setProvider(builtin)
    const bounded = [0, 1, 2].map(() =>
      logins.start('openai', 'api_key', 'admin')
    )
    assert.throws(() => logins.start('openai', 'api_key', 'admin'), /Too many/)
    for (const s of bounded) logins.cancel(s.id, 'admin')
  } finally {
    logins.close()
  }

  const auth = {
    api: {
      getSession: async ({ headers }: { headers: Headers }) => {
        const bearer = headers.get('authorization')
        if (bearer === 'Bearer admin' || (!bearer && headers.get('cookie')))
          return { user: { id: 'admin', role: 'admin' } }
        if (bearer === 'Bearer user')
          return { user: { id: 'user', role: 'user' } }
        return null
      },
    },
  } as unknown as typeof authInstance
  const app = express()
  app.use(express.json())
  app.use(cookieParser())
  app.use('/api/ai', createAiRouter(auth, ai))
  const server = app.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  assert.ok(address && typeof address !== 'string')
  const base = `http://127.0.0.1:${address.port}/api/ai`
  try {
    assert.equal((await fetch(base)).status, 401)
    assert.equal(
      (await fetch(base, { headers: { authorization: 'Bearer user' } })).status,
      403
    )
    assert.equal(
      (
        await fetch(base, {
          headers: { authorization: 'Bearer invalid', cookie: 'admin-cookie' },
        })
      ).status,
      401
    )
    assert.equal(
      (
        await fetch(`${base}/default`, {
          method: 'PUT',
          headers: {
            cookie: 'admin-cookie',
            'content-type': 'application/json',
          },
          body: JSON.stringify(ai.getDefault()),
        })
      ).status,
      403
    )
    const response = await fetch(base, {
      headers: { authorization: 'Bearer admin' },
    })
    assert.equal(response.headers.get('cache-control'), 'no-store')
    const metadata = await response.text()
    assert.ok(!metadata.includes('PRIVATE-CANARY'))
    assert.ok(metadata.includes('customApis'))
    const adminHeaders = {
      authorization: 'Bearer admin',
      'content-type': 'application/json',
    }
    const replace = { ...definition, keyless: false }
    assert.equal(
      (
        await fetch(`${base}/providers/replace`, {
          method: 'PUT',
          headers: adminHeaders,
          body: JSON.stringify(replace),
        })
      ).status,
      200
    )
    await ai.credentials.modify('replace', async () => ({
      type: 'api_key',
      key: 'OLD-ENDPOINT-CANARY',
    }))
    await ai.put('replace', { ...replace, name: 'Renamed only' })
    assert.deepEqual(await ai.credentials.read('replace'), {
      type: 'api_key',
      key: 'OLD-ENDPOINT-CANARY',
    })
    const login = await (
      await fetch(`${base}/providers/replace/login`, {
        method: 'POST',
        headers: adminHeaders,
        body: '{"method":"api_key"}',
      })
    ).json()
    await new Promise(resolve => setTimeout(resolve, 10))
    const pending = await (
      await fetch(`${base}/logins/${login.id}`, { headers: adminHeaders })
    ).json()
    assert.ok(pending.prompt)
    assert.equal(
      (
        await fetch(`${base}/providers/replace`, {
          method: 'PUT',
          headers: adminHeaders,
          body: JSON.stringify({
            ...replace,
            baseUrl: `${definition.baseUrl}/other`,
          }),
        })
      ).status,
      200
    )
    assert.equal(
      (
        await (
          await fetch(`${base}/logins/${login.id}`, { headers: adminHeaders })
        ).json()
      ).status,
      'cancelled'
    )
    assert.equal(
      (
        await fetch(`${base}/logins/${login.id}/answer`, {
          method: 'POST',
          headers: adminHeaders,
          body: JSON.stringify({
            promptId: pending.prompt.id,
            value: 'STALE-LOGIN-CANARY',
          }),
        })
      ).status,
      400
    )
    assert.equal(await ai.credentials.read('replace'), undefined)
    for (let i = 0; i < 65; i++)
      assert.equal(
        (await fetch(base, { headers: { authorization: 'Bearer admin' } }))
          .status,
        200
      )
  } finally {
    server.closeAllConnections()
    await new Promise<void>(resolve => server.close(() => resolve()))
  }

  const harness = await setupDurableHarness(ai.models, new AttachmentStore())
  try {
    const service = new ChatService(harness, ai.newConversationModel)
    const first = await service.createConversation('admin')
    await ai.setDefault({ provider: 'local', modelId: 'two' })
    const second = await service.createConversation('admin')
    assert.equal(
      (await (await harness.conversation(first, ctx))?.agent(ctx))?.model
        ?.modelId,
      'one'
    )
    assert.equal(
      (await (await harness.conversation(second, ctx))?.agent(ctx))?.model
        ?.modelId,
      'two'
    )
    const api = createApp({
      auth,
      ai,
      harness,
      models: ai.models,
      attachments: new AttachmentStore(),
    })
    const server = api.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const addr = server.address()
    assert.ok(addr && typeof addr !== 'string')
    const url = `http://127.0.0.1:${addr.port}/api/artifacts/capabilities`
    const headers = { authorization: 'Bearer admin' }
    try {
      assert.equal(
        (await (await fetch(url, { headers })).json()).supportsImages,
        true
      )
      assert.equal(
        (
          await (
            await fetch(`${url}?conversationId=${first}`, { headers })
          ).json()
        ).supportsImages,
        false
      )
      assert.equal(
        (
          await (
            await fetch(`${url}?conversationId=${second}`, { headers })
          ).json()
        ).supportsImages,
        true
      )
      assert.equal(
        (
          await fetch(`${url}?conversationId=${first}`, {
            headers: { authorization: 'Bearer user' },
          })
        ).status,
        403
      )
      assert.equal(
        (await fetch(`http://127.0.0.1:${addr.port}/api/secrets`, { headers }))
          .status,
        404
      )
    } finally {
      server.closeAllConnections()
      await new Promise<void>(resolve => server.close(() => resolve()))
    }
    const empty = new ChatService(harness, () => null)
    await assert.rejects(empty.createConversation('bob'), /No default AI model/)
  } finally {
    await harness.close(ctx)
  }
  const azureEndpoint = createServer(async (req, res) => {
    let body = ''
    for await (const chunk of req) body += chunk
    assert.equal(req.url, '/openai/v1/responses?api-version=2025-04-01-preview')
    assert.equal(req.headers['api-key'], 'AZURE-UI-CANARY')
    assert.equal(JSON.parse(body).model, 'saul-deployment')
    res.writeHead(200, { 'Content-Type': 'text/event-stream' })
    res.write(
      `data: ${JSON.stringify({
        type: 'response.output_item.added',
        output_index: 0,
        item: { type: 'message', id: 'msg', role: 'assistant', content: [] },
      })}\n\n`
    )
    res.write(
      `data: ${JSON.stringify({
        type: 'response.output_text.delta',
        output_index: 0,
        content_index: 0,
        delta: 'Azure UI answer',
      })}\n\n`
    )
    res.end(
      `data: ${JSON.stringify({
        type: 'response.completed',
        response: {
          id: 'azure-test',
          status: 'completed',
          output: [
            {
              type: 'message',
              id: 'msg',
              role: 'assistant',
              content: [
                {
                  type: 'output_text',
                  text: 'Azure UI answer',
                  annotations: [],
                },
              ],
            },
          ],
        },
      })}\n\n`
    )
  })
  azureEndpoint.listen(0, '127.0.0.1')
  await once(azureEndpoint, 'listening')
  const azureAddress = azureEndpoint.address()
  assert.ok(azureAddress && typeof azureAddress !== 'string')
  const azure = {
    baseUrl: `http://127.0.0.1:${azureAddress.port}/openai/v1`,
    apiVersion: '2025-04-01-preview',
    deployments: { 'gpt-4.1': 'saul-deployment' },
  }
  const azureRouter = express()
  azureRouter.use(express.json())
  azureRouter.use('/api/ai', createAiRouter(auth, ai))
  const azureApi = azureRouter.listen(0, '127.0.0.1')
  await once(azureApi, 'listening')
  const apiAddress = azureApi.address()
  assert.ok(apiAddress && typeof apiAddress !== 'string')
  const connectionUrl = `http://127.0.0.1:${apiAddress.port}/api/ai/providers/azure-openai-responses/connection`
  try {
    assert.equal(process.env.AZURE_OPENAI_BASE_URL, undefined)
    assert.equal(process.env.AZURE_OPENAI_API_KEY, undefined)
    const request = (token: string, body: unknown) =>
      fetch(connectionUrl, {
        method: 'PUT',
        headers: {
          authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      })
    assert.equal((await request('user', azure)).status, 403)
    assert.equal(
      (
        await request('admin', {
          ...azure,
          baseUrl: 'https://user:key@example.com',
        })
      ).status,
      400
    )
    assert.equal((await request('admin', azure)).status, 200)
    const azureLogin = new AiLogins(ai)
    try {
      const state = azureLogin.start(
        'azure-openai-responses',
        'api_key',
        'admin'
      )
      await new Promise(r => setTimeout(r, 10))
      azureLogin.answer(
        state.id,
        'admin',
        azureLogin.get(state.id, 'admin').prompt?.id,
        'AZURE-UI-CANARY'
      )
      await new Promise(r => setTimeout(r, 30))
      assert.equal(azureLogin.get(state.id, 'admin').status, 'complete')
    } finally {
      azureLogin.close()
    }
    const restored = new AiManager()
    await restored.load()
    const metadata = await restored.metadata()
    assert.deepEqual(
      metadata.providers.find(p => p.id === 'azure-openai-responses')?.azure,
      azure
    )
    assert.ok(!JSON.stringify(metadata).includes('AZURE-UI-CANARY'))
    const model = restored.models.getModel('azure-openai-responses', 'gpt-4.1')
    assert.ok(model)
    const result = await restored.models.completeSimple(model, {
      messages: [{ role: 'user', content: 'hello', timestamp: Date.now() }],
    })
    assert.equal(result.stopReason, 'stop', result.errorMessage ?? '')
    assert.equal(
      result.content[0]?.type === 'text' ? result.content[0].text : null,
      'Azure UI answer'
    )
    // UI-owned endpoint/version/mapping also win over stale deployment env.
    process.env.AZURE_OPENAI_BASE_URL = 'http://127.0.0.1:1/wrong'
    process.env.AZURE_OPENAI_API_VERSION = 'wrong'
    process.env.AZURE_OPENAI_DEPLOYMENT_NAME_MAP = 'gpt-4.1=wrong'
    try {
      const again = await restored.models.completeSimple(model, {
        messages: [
          { role: 'user', content: 'hello again', timestamp: Date.now() },
        ],
      })
      assert.equal(again.stopReason, 'stop', again.errorMessage ?? '')
    } finally {
      delete process.env.AZURE_OPENAI_BASE_URL
      delete process.env.AZURE_OPENAI_API_VERSION
      delete process.env.AZURE_OPENAI_DEPLOYMENT_NAME_MAP
    }
    await restored.setAzure({
      ...azure,
      deployments: { 'gpt-4.1': 'renamed-deployment' },
    })
    assert.ok(await restored.models.checkAuth('azure-openai-responses'))
    await restored.setAzure({
      ...azure,
      baseUrl: 'https://different.openai.azure.com/openai/v1',
    })
    assert.equal(
      await restored.models.checkAuth('azure-openai-responses'),
      undefined
    )
  } finally {
    azureEndpoint.closeAllConnections()
    azureApi.closeAllConnections()
    await Promise.all(
      [azureEndpoint, azureApi].map(
        server => new Promise<void>(resolve => server.close(() => resolve()))
      )
    )
  }
  await db
    .update(secrets)
    .set({ value: encryptSetting('wrong-record', 'corrupt') })
    .where(eq(secrets.name, 'ai:credential:local'))
  await assert.rejects(new AiManager().load(), /cannot be unlocked/)
})
