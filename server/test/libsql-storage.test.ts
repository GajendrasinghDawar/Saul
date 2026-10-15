/// <reference lib="es2024.promise" />
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { BACKGROUND_CONTEXT as ctx } from '@earendil-works/chord/context'
import type { SqliteExecutor } from '@earendil-works/pi-durable/storage/sqlite'
import { createStorageConformance } from '@earendil-works/pi-durable/testing'
import { createClient, type TransactionMode } from '@libsql/client'
import { LibsqlDatabase, openLibsqlStorage } from '../storage/libsql.ts'

for (const check of createStorageConformance({
  assertions: {
    ok: assert.ok,
    strictEqual: assert.strictEqual,
    deepEqual: assert.deepStrictEqual,
    partialDeepEqual: assert.partialDeepStrictEqual,
    greaterThan: (actual, expected) => assert.ok(actual > expected),
    rejects: async (operation, message) => {
      await assert.rejects(operation, error => {
        assert.ok(error instanceof Error)
        assert.ok(error.message.includes(message), error.message)
        return true
      })
    },
  },
  withStorage: async use => {
    const storage = await openLibsqlStorage('file::memory:')
    try {
      await use(storage)
    } finally {
      await storage.close(ctx)
    }
  },
})) {
  test(`libSQL storage: ${check.name}`, check.run)
}

test('libSQL preserves a Node SQLite database and new writes across reopen', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'saul-libsql-'))
  const env = { ...process.env }
  delete env.NODE_TEST_CONTEXT
  try {
    // Like the chat fixture, finish the native-driver process before deleting
    // its file. Windows can retain native file handles until process teardown.
    const result = await promisify(execFile)(
      process.execPath,
      [
        '--test',
        fileURLToPath(new URL('fixtures/libsql-reopen.ts', import.meta.url)),
      ],
      { cwd: directory, env, timeout: 30_000 }
    )
    assert.match(result.stdout, /retains records and IDs across reopen/)
  } finally {
    await rm(directory, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100,
    })
  }
})

test('libSQL isolates transactions, expires handles and drains before close', async () => {
  const db = new LibsqlDatabase(createClient({ url: 'file::memory:' }))
  await db.exec(
    'CREATE TABLE probe (value TEXT); CREATE TABLE other (id INTEGER)'
  )
  const entered = Promise.withResolvers<void>()
  const release = Promise.withResolvers<void>()
  let handle: SqliteExecutor | undefined
  const failure = new Error('Reject the change')
  const transaction = db.transaction(async tx => {
    handle = tx
    await tx.run('INSERT INTO probe VALUES (?)', 'discard')
    entered.resolve()
    await release.promise
    throw failure
  })
  // Attach rejection handling before releasing the blocked transaction.
  const rejected = assert.rejects(transaction, error => error === failure)
  await entered.promise
  const outside = db.run('INSERT INTO probe VALUES (?)', 'keep')
  const rows = db.all<{ value: string }>('SELECT value FROM probe')
  const closing = db.close()
  release.resolve()
  await rejected
  await outside
  assert.deepEqual(
    (await rows).map(row => row.value),
    ['keep']
  )
  await closing
  assert.ok(handle)
  await assert.rejects(
    handle.run('INSERT INTO probe VALUES (?)', 'late'),
    /expired/
  )
  await assert.rejects(db.get('SELECT value FROM probe'), /closed/)
})

test('libSQL refuses further work after an unacknowledged commit', async () => {
  const client = createClient({ url: 'file::memory:' })
  const start = client.transaction.bind(client)
  client.transaction = async (mode?: TransactionMode) => {
    const transaction = await start(mode)
    const commit = transaction.commit.bind(transaction)
    transaction.commit = async () => {
      await commit()
      throw new Error('Commit response lost')
    }
    return transaction
  }
  const db = new LibsqlDatabase(client)
  await db.exec('CREATE TABLE probe (value TEXT)')
  await assert.rejects(
    db.transaction(tx => tx.run('INSERT INTO probe VALUES (?)', 'committed')),
    /commit outcome is uncertain/
  )
  await assert.rejects(db.get('SELECT value FROM probe'), /uncertain/)
  await assert.rejects(db.run('DELETE FROM probe'), /uncertain/)
  // Inspect authoritative state through the test's client, not the poisoned facade.
  const result = await client.execute('SELECT value FROM probe')
  assert.equal(result.rows[0]?.value, 'committed')
  await db.close()
})

test('libSQL distinguishes rollback failure from guaranteed rollback', async () => {
  const client = createClient({ url: 'file::memory:' })
  const start = client.transaction.bind(client)
  const rollbackError = new Error('Rollback connection lost')
  client.transaction = async (mode?: TransactionMode) => {
    const transaction = await start(mode)
    transaction.rollback = async () => {
      throw rollbackError
    }
    return transaction
  }
  const db = new LibsqlDatabase(client)
  const callbackError = new Error('Callback failed')
  try {
    await assert.rejects(
      db.transaction(async () => {
        throw callbackError
      }),
      error => {
        assert.ok(error instanceof AggregateError)
        assert.deepEqual(error.errors, [callbackError, rollbackError])
        return true
      }
    )
    await assert.rejects(db.get('SELECT 1'), /rollback failed/)
  } finally {
    await db.close()
  }
})
