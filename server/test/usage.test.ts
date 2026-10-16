import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

test('usage API on isolated storage', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'saul-usage-'))
  try {
    const result = await promisify(execFile)(
      process.execPath,
      ['--test', fileURLToPath(new URL('fixtures/usage.ts', import.meta.url))],
      {
        cwd: directory,
        env: {
          PATH: process.env.PATH,
          SystemRoot: process.env.SystemRoot,
          NODE_ENV: 'test',
          SAUL_APP_STORAGE_DATABASE_URL: 'file::memory:',
          SAUL_APP_STORAGE_DATABASE_TOKEN: '',
          SAUL_DURABLE_STORAGE_DATABASE_URL: '',
          SAUL_SECRETS_KEY: 'ab'.repeat(32),
        },
        timeout: 30000,
      }
    )
    assert.match(result.stdout, /authenticated usage ledger/)
    process.stdout.write(result.stdout)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
