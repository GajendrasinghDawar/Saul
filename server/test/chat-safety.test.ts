import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

for (const driver of ['node', 'libsql']) {
  test(`chat delivery and approvals on isolated databases (${driver})`, async () => {
    // db/index.ts loads .env from cwd. Run outside the repo so a developer's
    // credentials and databases cannot become test inputs.
    const directory = await mkdtemp(join(tmpdir(), 'saul-chat-test-'))
    const env = { ...process.env }
    delete env.NODE_TEST_CONTEXT
    try {
      const result = await promisify(execFile)(
        process.execPath,
        [
          '--test',
          fileURLToPath(new URL('fixtures/chat-safety.ts', import.meta.url)),
        ],
        {
          cwd: directory,
          env: {
            ...env,
            NODE_ENV: 'test',
            SAUL_APP_STORAGE_DATABASE_URL: 'file::memory:',
            SAUL_APP_STORAGE_DATABASE_TOKEN: '',
            SAUL_DURABLE_STORAGE_DATABASE_URL:
              driver === 'libsql' ? 'file:durable.sqlite' : '',
            SAUL_DURABLE_STORAGE_DATABASE_TOKEN: '',
          },
          timeout: 30_000,
        }
      )
      assert.match(result.stdout, /retry after restart admits one turn/)
      process.stdout.write(result.stdout)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
}
