import assert from 'node:assert/strict'
import test from 'node:test'
import { createSession } from '../src/features/sessions/session-api.ts'

test('chat creation retries a lost response with the same user-scoped command ID', async t => {
  const data = new Map<string, string>()
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => {
        data.set(key, value)
      },
      removeItem: (key: string) => {
        data.delete(key)
      },
    },
  })
  t.after(() => Reflect.deleteProperty(globalThis, 'localStorage'))
  const admitted = new Map<string, number>()
  const attempts: string[] = []
  let fail = true
  let status = 200
  t.mock.method(
    globalThis,
    'fetch',
    async (url: string, options?: RequestInit) => {
      if (url === '/csrf-token') return Response.json({ csrfToken: 'fixture' })
      const requestId = JSON.parse(String(options?.body)).requestId
      assert.equal(typeof requestId, 'string')
      attempts.push(requestId)
      if (status !== 200)
        return Response.json({ error: 'Sign in again' }, { status })
      if (!admitted.has(requestId)) admitted.set(requestId, admitted.size + 1)
      if (fail) throw new TypeError('Response lost')
      return Response.json({ conversationId: admitted.get(requestId) })
    }
  )
  await assert.rejects(createSession('alice'), /Response lost/)
  fail = false
  for (status of [401, 403]) {
    await assert.rejects(createSession('alice'), /Sign in again/)
  }
  status = 200
  assert.equal(await createSession('alice'), '1')
  assert.equal(new Set(attempts).size, 1)
  assert.equal(
    await createSession('alice'),
    '2',
    'a confirmed command starts a new operation next time'
  )
  assert.equal(
    await createSession('bob'),
    '3',
    'users do not share pending operations'
  )
})
