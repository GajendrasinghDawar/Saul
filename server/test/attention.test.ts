import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

test('attention inbox on isolated SQLite', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'saul-attention-'))
  const env = { ...process.env }
  delete env.NODE_TEST_CONTEXT
  try {
    const result = await promisify(execFile)(
      process.execPath,
      [
        '--test',
        fileURLToPath(new URL('fixtures/attention.ts', import.meta.url)),
      ],
      {
        cwd: directory,
        env: {
          ...env,
          TURSO_DATABASE_URL: 'file::memory:',
          TURSO_AUTH_TOKEN: '',
          TURSO_SYNC_URL: '',
        },
        timeout: 30000,
      }
    )
    assert.match(result.stdout, /attention includes owned signals/)
    process.stdout.write(result.stdout)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
