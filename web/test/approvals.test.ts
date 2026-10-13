import assert from 'node:assert/strict'
import test from 'node:test'
import { approveEffect, getApproval, rejectEffect } from '../src/lib/api.ts'

test('approval API requires authoritative display fields and a known status', async t => {
  for (const status of ['pending', 'approved', 'rejected', 'consumed']) {
    t.mock.method(globalThis, 'fetch', async () =>
      Response.json({
        approval: {
          id: 'one',
          action: 'Write file',
          detail: '<plain text>',
          status,
        },
      })
    )
    assert.deepEqual(await getApproval('one'), {
      id: 'one',
      action: 'Write file',
      detail: '<plain text>',
      status,
    })
  }
  for (const approval of [
    null,
    {},
    { id: 'other', status: 'pending' },
    { id: 'one', action: 'Write', detail: {}, status: 'pending' },
    { id: 'one', action: 'Write', detail: 'text', status: 'executed' },
  ]) {
    t.mock.method(globalThis, 'fetch', async () => Response.json({ approval }))
    await assert.rejects(getApproval('one'), /unavailable/)
  }
  t.mock.method(
    globalThis,
    'fetch',
    async () => new Response('Not found', { status: 404 })
  )
  await assert.rejects(getApproval('one'), /Not found/)
})

test('decisions use CSRF, no digest, and expose conflicts for state reload', async t => {
  const calls: { url: string; options?: RequestInit }[] = []
  t.mock.method(
    globalThis,
    'fetch',
    async (url: string, options?: RequestInit) => {
      calls.push({ url, options })
      return url === '/csrf-token'
        ? Response.json({ csrfToken: 'token' })
        : new Response('Already decided', { status: 409 })
    }
  )
  await assert.rejects(approveEffect('a/b'), /Already decided/)
  await assert.rejects(rejectEffect('a/b'), /Already decided/)
  for (const call of calls.filter(call => call.options?.method === 'POST')) {
    assert.match(call.url, /a%2Fb/)
    assert.equal(
      new Headers(call.options?.headers).get('x-csrf-token'),
      'token'
    )
    assert.equal(call.options?.body, undefined)
  }
})
