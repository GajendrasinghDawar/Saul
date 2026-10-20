# Pi-Durable storage through libSQL

Saul can open Pi's existing `SqliteStorage` using `@libsql/client`. Pi still owns
its schema, migrations, history, documents, submissions and checkpoints. The
adapter in `server/storage/libsql.ts` supplies SQL execution and transactions.
It does not replace Pi's agent runtime.

## Development and production

`npm run dev` forces development mode. Remote database URLs and tokens are
ignored in development and tests. The app defaults to
`data/saul-app.dev.sqlite`; Pi uses Node SQLite at `data/saul-pi.dev.sqlite`.
Startup applies checked-in app migrations before loading settings. Pi creates
its own schema when its harness opens. Existing local databases are not imported
or deleted.

To try the libSQL driver locally, set a `file:` URL in the untracked root `.env`:

```dotenv
SAUL_DURABLE_STORAGE_DATABASE_URL=file:./data/saul-pi.dev.sqlite
```

The file must have only one owner. Do not open both drivers or run a second Saul
instance against it at the same time. Use an existing file only after backup;
the tests use disposable files, not the application's current data.

Production requires two separate remote Turso/libSQL-compatible databases:

```dotenv
NODE_ENV=production
SAUL_DURABLE_STORAGE_DATABASE_URL=libsql://<pi-database-host>
SAUL_DURABLE_STORAGE_DATABASE_TOKEN=<pi-database-token>
SAUL_APP_STORAGE_DATABASE_URL=libsql://<app-database-host>
SAUL_APP_STORAGE_DATABASE_TOKEN=<app-database-token>
```

Keep these bootstrap values outside Settings and out of Git. Existing process
environment values take priority over `.env`. Production stops if either remote
URL or token is missing, if a URL is local, or if both URLs are identical. It
never falls back to local storage. Both stores initialize their schemas on
startup, but schema creation does not import accounts or history.

Generate and review app migration files with `npm run db:generate`; validate
them with `npm run db:check`. Both commands force development mode. Startup
applies the checked-in migration history and never runs schema push. See the
[database setup guide](local-development.md#database-setup) for existing databases without
migration history. Review migration SQL and back up data before production
upgrades; future destructive SQL is not made safe merely by running it at boot.

The libSQL path does not configure an embedded replica, sync URL, or offline
writes. A remote database is authoritative. A local `file:` URL remains local
and does not protect against VPS disk loss.

## Transaction and failure behaviour

- All facade operations are serialized. Unrelated SQL waits until the active
  transaction finishes.
- Each transaction uses the SDK's `transaction('write')` handle, not independent
  client calls to `BEGIN` and `COMMIT`.
- A callback failure rolls back. An expired handle cannot execute more SQL.
- A rollback failure reports both errors and disables subsequent database work.
- A commit failure is treated as uncertain: the server may have committed before
  the response was lost. The adapter does not retry or claim rollback. It disables
  subsequent database work until the harness is closed and reopened. Saul does
  not automatically reconstruct that harness; restart the single server process
  and inspect saved state before retrying uncertain operations.
- Close waits for already queued operations and then closes the client.

This does not cancel already running outside effects, guarantee exactly-once
tool execution, or provide cross-process leadership. Keep exactly one active
harness, including during VPS replacement: stop the old process before starting
the new one.

## Verified locally

```powershell
npx tsc --noEmit
node --test server/test/libsql-storage.test.ts server/test/chat-safety.test.ts
```

The tests cover all 23 upstream storage conformance cases through local libSQL:
records, submission IDs, fork history, documents, pagination, atomic failures,
and close behaviour. Additional checks cover reopening a Node-created database,
ID continuity, transaction isolation, expired handles, draining before close,
and an injected lost commit acknowledgement. The existing Saul HTTP chat and
approval fixture runs with both Node SQLite and libSQL, including deduplication
after harness restart and concurrent admission.

These are not tests against Turso Cloud. Before cloud cutover, run conformance and
realistic agent workloads against a disposable remote database. Test actual
connection loss, transaction limits, restart recovery and latency. Preserve both
databases' identities when importing existing data. Back up encryption/signing
keys, external attachments and any agent workspace separately.
