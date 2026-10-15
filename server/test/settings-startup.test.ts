import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { readMigrationFiles } from 'drizzle-orm/migrator'

const startup = `import '${new URL('../setup/settings.ts', import.meta.url).href}'`
const inspectConfig = `
import { appStorageConfig, durableStorageConfig } from '${new URL('../storage/config.ts', import.meta.url).href}'
console.log(JSON.stringify({ app: appStorageConfig, durable: durableStorageConfig }))
`

function run(code: string, cwd: string, env: NodeJS.ProcessEnv = {}) {
  return spawnSync(process.execPath, ['--input-type=module', '-e', code], {
    cwd,
    env: {
      ...process.env,
      NODE_ENV: 'development',
      SAUL_APP_STORAGE_DATABASE_URL: 'libsql://app.example.invalid',
      SAUL_APP_STORAGE_DATABASE_TOKEN: 'fake-app-token',
      SAUL_DURABLE_STORAGE_DATABASE_URL: 'libsql://pi.example.invalid',
      SAUL_DURABLE_STORAGE_DATABASE_TOKEN: 'fake-pi-token',
      ...env,
    },
    encoding: 'utf8',
    timeout: 10_000,
  })
}

test('development ignores cloud databases and tokens; production requires two remote databases', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'saul-storage-config-'))
  try {
    for (const mode of ['development', 'test']) {
      const result = run(inspectConfig, directory, { NODE_ENV: mode })
      assert.ifError(result.error)
      assert.equal(result.status, 0, result.stderr)
      const config = JSON.parse(result.stdout)
      assert.equal(config.app.url, 'file:./data/saul-app.dev.sqlite')
      assert.equal(config.app.authToken, undefined)
      assert.equal(config.durable.url, undefined)
      assert.equal(config.durable.authToken, undefined)
      assert.equal(config.durable.localPath, './data/saul-pi.dev.sqlite')
    }
    const production = run(inspectConfig, directory, { NODE_ENV: 'production' })
    assert.equal(production.status, 0, production.stderr)
    const config = JSON.parse(production.stdout)
    assert.equal(config.app.url, 'libsql://app.example.invalid')
    assert.equal(config.app.authToken, 'fake-app-token')
    assert.equal(config.durable.url, 'libsql://pi.example.invalid')
    assert.equal(config.durable.authToken, 'fake-pi-token')
    for (const override of [
      { SAUL_APP_STORAGE_DATABASE_URL: '' },
      { SAUL_DURABLE_STORAGE_DATABASE_URL: '' },
      { SAUL_APP_STORAGE_DATABASE_URL: 'file:production.sqlite' },
      { SAUL_DURABLE_STORAGE_DATABASE_URL: 'file:production.sqlite' },
      { SAUL_APP_STORAGE_DATABASE_TOKEN: '' },
      { SAUL_DURABLE_STORAGE_DATABASE_TOKEN: '' },
      { SAUL_DURABLE_STORAGE_DATABASE_URL: 'libsql://app.example.invalid' },
      { SAUL_APP_STORAGE_DATABASE_URL: 'https://localhost/database' },
    ]) {
      const result = run(inspectConfig, directory, {
        NODE_ENV: 'production',
        ...override,
      })
      assert.equal(result.status, 1)
      assert.doesNotMatch(result.stderr, /fake-app-token|fake-pi-token/)
    }
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('startup creates the full app schema locally and preserves data across restart', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'saul-settings-startup-'))
  try {
    const first = run(startup, directory)
    assert.ifError(first.error)
    assert.equal(first.status, 0, first.stderr)
    const path = join(directory, 'data', 'saul-app.dev.sqlite')
    const before = new DatabaseSync(path)
    try {
      const tables = before
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all()
      for (const name of [
        'user',
        'account',
        'session',
        'deviceCode',
        'secrets',
        'todos',
      ])
        assert.ok(
          tables.some(table => table.name === name),
          name
        )
      const columns = before.prepare('PRAGMA table_info(user)').all()
      assert.ok(columns.some(column => column.name === 'role'))
      before
        .prepare(
          "INSERT INTO user (id, name, email, emailVerified, role, createdAt, updatedAt) VALUES ('keep', 'Test', 'test@example.invalid', 0, 'admin', 1, 1)"
        )
        .run()
      assert.equal(
        before
          .prepare('SELECT count(*) AS count FROM __drizzle_migrations')
          .get()?.count,
        3
      )
    } finally {
      before.close()
    }
    const second = run(startup, directory)
    assert.equal(second.status, 0, second.stderr)
    const after = new DatabaseSync(path)
    try {
      assert.equal(
        after.prepare("SELECT role FROM user WHERE id = 'keep'").get()?.role,
        'admin'
      )
      assert.equal(
        after
          .prepare('SELECT count(*) AS count FROM __drizzle_migrations')
          .get()?.count,
        3
      )
    } finally {
      after.close()
    }
    const locked = new DatabaseSync(path)
    try {
      locked
        .prepare(
          "INSERT INTO secrets (name, value, kind, updatedAt) VALUES ('AZURE_OPENAI_API_KEY', 'invalid-ciphertext', 'secret', 1)"
        )
        .run()
    } finally {
      locked.close()
    }
    const invalidSettings = run(startup, directory)
    assert.equal(invalidSettings.status, 0)
    assert.doesNotMatch(
      invalidSettings.stderr,
      /invalid-ciphertext|fake-app-token/
    )
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('email and S3 use environment configuration and ignore old overrides', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'saul-deployment-settings-'))
  try {
    await writeFile(
      join(directory, '.env'),
      [
        'RESEND_API_KEY=file-email-key',
        'MY_EMAIL_ADDRESS=reminders@example.invalid',
        'S3_ENDPOINT=https://storage.example.invalid',
        'S3_REGION=auto',
        'S3_BUCKET=env-bucket',
        'S3_ACCESS_KEY_ID=env-access-key',
        'S3_SECRET_ACCESS_KEY=env-secret-key',
      ].join('\n')
    )
    const result = run(
      `
import assert from 'node:assert/strict'
import { db, migrateAppDatabase } from '${new URL('../db/index.ts', import.meta.url).href}'
import { secrets } from '${new URL('../db/schema.ts', import.meta.url).href}'
import { getSecret } from '${new URL('../secretsManager.ts', import.meta.url).href}'
import { setupAttachments } from '${new URL('../setup/attachments.ts', import.meta.url).href}'
await migrateAppDatabase()
const expected = {
  RESEND_API_KEY: 'injected-email-key',
  MY_EMAIL_ADDRESS: 'reminders@example.invalid',
  S3_ENDPOINT: 'https://storage.example.invalid',
  S3_REGION: 'auto',
  S3_BUCKET: 'env-bucket',
  S3_ACCESS_KEY_ID: 'env-access-key',
  S3_SECRET_ACCESS_KEY: 'env-secret-key',
}
// Obsolete ciphertext must neither override the environment nor require its
// old encryption key. Rows are retained.
await db.insert(secrets).values(Object.keys(expected).map(name => ({
  name, value: 'old-invalid-ciphertext', kind: 'secret', updatedAt: new Date(),
})))
for (const [name, value] of Object.entries(expected)) assert.equal(getSecret(name), value)
assert.equal(setupAttachments().capabilities(false).enabled, true)
assert.equal((await db.select().from(secrets)).length, 7)
// Missing deployment configuration must not revive obsolete UI overrides.
delete process.env.S3_SECRET_ACCESS_KEY
delete process.env.RESEND_API_KEY
assert.equal(getSecret('RESEND_API_KEY'), '')
assert.equal(setupAttachments().capabilities(false).enabled, false)
`,
      directory,
      {
        RESEND_API_KEY: 'injected-email-key',
        MY_EMAIL_ADDRESS: undefined,
        S3_ENDPOINT: undefined,
        S3_REGION: undefined,
        S3_BUCKET: undefined,
        S3_ACCESS_KEY_ID: undefined,
        S3_SECRET_ACCESS_KEY: undefined,
        SAUL_SECRETS_KEY: undefined,
      }
    )
    assert.ifError(result.error)
    assert.equal(result.status, 0, result.stderr)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('startup applies pending migrations to the previous schema without losing accounts', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'saul-app-upgrade-'))
  try {
    const path = join(directory, 'previous.sqlite')
    const before = new DatabaseSync(path)
    try {
      before.exec(
        'CREATE TABLE __drizzle_migrations (id SERIAL PRIMARY KEY, hash TEXT NOT NULL, created_at NUMERIC)'
      )
      const previous = readMigrationFiles({
        migrationsFolder: fileURLToPath(new URL('../drizzle', import.meta.url)),
      }).slice(0, 2)
      for (const migration of previous) {
        for (const statement of migration.sql) before.exec(statement)
        before
          .prepare(
            'INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)'
          )
          .run(migration.hash, migration.folderMillis)
      }
      before
        .prepare(
          "INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt) VALUES ('keep', 'Old User', 'old@example.invalid', 0, 1, 1)"
        )
        .run()
    } finally {
      before.close()
    }
    const result = run(startup, directory, {
      SAUL_APP_STORAGE_DATABASE_URL: 'file:previous.sqlite',
    })
    assert.equal(result.status, 0, result.stderr)
    const after = new DatabaseSync(path)
    try {
      assert.deepEqual(
        {
          ...after
            .prepare("SELECT name, role FROM user WHERE id = 'keep'")
            .get(),
        },
        { name: 'Old User', role: 'user' }
      )
      assert.equal(
        after
          .prepare(
            "SELECT count(*) AS count FROM sqlite_master WHERE name = 'deviceCode'"
          )
          .get()?.count,
        1
      )
      assert.equal(
        after
          .prepare('SELECT count(*) AS count FROM __drizzle_migrations')
          .get()?.count,
        3
      )
    } finally {
      after.close()
    }
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('failed migrations stop startup without resetting existing data or leaking SQL', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'saul-settings-startup-'))
  try {
    const path = join(directory, 'existing.sqlite')
    const before = new DatabaseSync(path)
    before.exec("CREATE TABLE user (id TEXT); INSERT INTO user VALUES ('keep')")
    before.close()
    const result = run(startup, directory, {
      SAUL_APP_STORAGE_DATABASE_URL: 'file:existing.sqlite',
    })
    assert.ifError(result.error)
    assert.equal(result.status, 1)
    assert.match(result.stderr, /App database migration failed/)
    assert.doesNotMatch(
      result.stderr,
      /encryption key|select |params:|fake-app-token/i
    )
    const after = new DatabaseSync(path)
    try {
      assert.equal(after.prepare('SELECT id FROM user').get()?.id, 'keep')
      assert.equal(
        after
          .prepare('SELECT count(*) AS count FROM __drizzle_migrations')
          .get()?.count,
        0
      )
      assert.equal(
        after
          .prepare(
            "SELECT count(*) AS count FROM sqlite_master WHERE name = 'account'"
          )
          .get()?.count,
        0
      )
    } finally {
      after.close()
    }
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
