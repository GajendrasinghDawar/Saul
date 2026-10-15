import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

test('referenced replies and read-only history on isolated SQLite', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'saul-history-'))
  const env = { ...process.env }
  delete env.NODE_TEST_CONTEXT
  try {
    const result = await promisify(execFile)(
      process.execPath,
      [
        '--test',
        fileURLToPath(new URL('fixtures/chat-history.ts', import.meta.url)),
      ],
      {
        cwd: directory,
        env: {
          ...env,
          NODE_ENV: 'test',
          SAUL_APP_STORAGE_DATABASE_URL: 'file::memory:',
          SAUL_APP_STORAGE_DATABASE_TOKEN: '',
        },
        timeout: 30_000,
      }
    )
    assert.match(result.stdout, /fork visibility/)
    process.stdout.write(result.stdout)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
