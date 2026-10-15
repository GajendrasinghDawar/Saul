import assert from 'node:assert/strict'
import test from 'node:test'
import { BACKGROUND_CONTEXT as ctx } from '@earendil-works/chord/context'
import type { ConversationId } from '@earendil-works/pi-durable'
import { openNodeSqliteStorage } from '@earendil-works/pi-durable/storage/sqlite/node'
import { openLibsqlStorage } from '../../storage/libsql.ts'

test('Node SQLite to libSQL retains records and IDs across reopen', async () => {
  const original = await openNodeSqliteStorage('pi.sqlite')
  const firstId = await original.mintId<ConversationId>()
  try {
    await original.commit(
      [{ type: 'conversation', value: { id: firstId } }],
      ctx
    )
  } finally {
    await original.close(ctx)
  }
  const storage = await openLibsqlStorage('file:pi.sqlite')
  let nextId: ConversationId
  try {
    assert.deepEqual(await storage.conversation(firstId, ctx), { id: firstId })
    nextId = await storage.mintId<ConversationId>()
    assert.ok(nextId > firstId)
    await storage.commit([{ type: 'conversation', value: { id: nextId } }], ctx)
  } finally {
    await storage.close(ctx)
  }
  const reopened = await openLibsqlStorage('file:pi.sqlite')
  try {
    assert.deepEqual(await reopened.conversation(firstId, ctx), { id: firstId })
    assert.deepEqual(await reopened.conversation(nextId, ctx), { id: nextId })
    assert.ok((await reopened.mintId()) > nextId)
  } finally {
    await reopened.close(ctx)
  }
})
