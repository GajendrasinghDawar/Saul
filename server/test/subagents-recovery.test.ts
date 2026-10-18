import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

test('subagent recovery on real SQLite', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'saul-subagents-'))
  const env = { ...process.env }
  delete env.NODE_TEST_CONTEXT
  try {
    // Native SQLite handles must leave the process before cleanup on Windows.
    const result = await promisify(execFile)(
      process.execPath,
      [
        '--test',
        fileURLToPath(
          new URL('fixtures/subagents-recovery.ts', import.meta.url)
        ),
      ],
      { cwd: directory, env, timeout: 30000 }
    )
    assert.match(
      result.stdout,
      /subagent tool reuses spawn and send after SQLite reopen/
    )
  } finally {
    await rm(directory, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100,
    })
  }
})
