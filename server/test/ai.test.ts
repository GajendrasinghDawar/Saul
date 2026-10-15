import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

test('administrator AI management on isolated local storage', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'saul-ai-'))
  try {
    const result = await promisify(execFile)(
      process.execPath,
      ['--test', fileURLToPath(new URL('fixtures/ai.ts', import.meta.url))],
      {
        cwd: directory,
        env: {
          PATH: process.env.PATH,
          SystemRoot: process.env.SystemRoot,
          NODE_ENV: 'test',
          SAUL_APP_STORAGE_DATABASE_URL: 'file:app.sqlite',
          SAUL_DURABLE_STORAGE_DATABASE_URL: '',
          SAUL_SECRETS_KEY: 'ab'.repeat(32),
          COOKIE_SECRET: 'test-cookie',
          CSRF_SECRET: 'test-csrf',
          BETTER_AUTH_SECRET: 'test-auth-secret-long-enough-for-tests',
        },
        timeout: 30000,
      }
    )
    assert.match(result.stdout, /AI persistence/)
    process.stdout.write(result.stdout)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
