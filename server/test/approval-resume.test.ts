import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

for (const driver of ['node', 'libsql']) {
  test(`approval resumes the originating conversation (${driver})`, async () => {
    const directory = await mkdtemp(join(tmpdir(), 'saul-approval-'))
    try {
      const result = await promisify(execFile)(
        process.execPath,
        [
          '--test',
          fileURLToPath(
            new URL('fixtures/approval-resume.ts', import.meta.url)
          ),
        ],
        {
          cwd: directory,
          env: {
            PATH: process.env.PATH,
            SystemRoot: process.env.SystemRoot,
            NODE_ENV: 'test',
            SAUL_APP_STORAGE_DATABASE_URL: 'file:app.sqlite',
            SAUL_APP_STORAGE_DATABASE_TOKEN: '',
            SAUL_DURABLE_STORAGE_DATABASE_URL:
              driver === 'libsql' ? 'file:durable.sqlite' : '',
            SAUL_DURABLE_STORAGE_DATABASE_TOKEN: '',
          },
          timeout: 30_000,
        }
      )
      assert.match(
        result.stdout,
        /approval continues without a chat subscriber/
      )
      process.stdout.write(result.stdout)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
}
