# Turso Cloud for Saul and Pi-Durable

## Verdict

Turso fits the goal of recovering Saul on a replacement VPS without relying on that VPS's disk.

- Saul's account/settings database already uses `@libsql/client` and Drizzle's libSQL adapter. It can be configured for a remote, libSQL-compatible Turso Cloud database.
- Pi-Durable has no Turso adapter in the installed package, but its portable SQLite storage accepts a small asynchronous database adapter. An adapter backed by `@libsql/client` is feasible without replacing its harness, storage schema, or task model.
- A disposable local libSQL probe passed Pi-Durable migrations, an atomic conversation/entry/submission commit, rollback, and reopening with preserved request identity and IDs.
- This is not a production-cloud compatibility claim. Cloud transactions, latency, ambiguous failures, full storage conformance, and task recovery must be tested against a disposable real Turso database before changing production storage.

No application database, credentials, or configuration were changed during this investigation. The probe used a temporary database that was deleted afterward.

## Current storage split

```text
Account database: @libsql/client -> local file by default
  users, sessions, ownership links, todos, approvals, encrypted settings

Agent database: openNodeSqliteStorage('./data/lali-durable.sqlite')
  conversations, entries, submissions, tasks, documents, checkpoints
```

Moving only the account database leaves the actual transcript and task state on the VPS. A surviving ownership link is not enough to recover a conversation whose durable database was lost.

Sources: [account database initialization](../server/db/index.ts), [account schema](../server/db/schema.ts), [durable harness initialization](../server/setup/durable.ts).

## Recommended first cloud configuration

```text
One active Saul process on a VPS
  ├── Drizzle/libSQL -> Turso account database
  ├── Pi SqliteStorage -> libSQL adapter -> Turso agent database
  └── AttachmentStore -> external private S3 storage (when enabled)

VPS workspace files -> separate backup policy
Deployment keys -> separate secure backup
```

Use two distinct cloud databases initially, matching the existing ownership of schemas and migrations. Do not combine databases or rewrite Pi's storage logic merely to enable cloud storage.

For the first implementation, make remote libSQL databases authoritative for both reads and writes. Do not silently fall back to a new local database if cloud configuration or authentication fails. Otherwise the user can unknowingly create a second installation with different user/conversation identities.

Database locations and credentials remain external bootstrap configuration. They must not be supplied through Settings, whose values require the account database to be opened first. Pi database URL/token settings will need to be introduced; changing `TURSO_DATABASE_URL` alone does not change Pi's database.

### Keep engine/SDK choices explicit

Current Turso documentation distinguishes its newer Turso engine and SDKs from libSQL:

- `@libsql/client`: existing libSQL applications and ORM integration, including Drizzle.
- `@tursodatabase/serverless`: remote access to the newer Turso engine.
- `@tursodatabase/sync`: local-first writes with explicit push/pull.

The researched path uses the already-installed `@libsql/client` and a libSQL-compatible cloud database. Do not assume that credentials or SQL behavior for a newly selected Turso engine are interchangeable; verify the selected cloud product.

Source: [official TypeScript SDK reference](https://docs.turso.tech/sdk/ts/reference).

## How the Pi adapter fits

The portable storage interface is six operations:

```text
exec(sql)
run(sql, ...params)
get(sql, ...params)
all(sql, ...params)
transaction(callback)
close()
```

`SqliteStorage.open(database)` applies Pi's migrations through this interface. `SqliteStorage.commit(writes)` performs metadata reads, identity checks, writes, and sequence advancement inside a transaction.

Sources: [Pi adapter interface](https://github.com/earendil-works/pi/blob/6fb2e7815167e6b19006fc526d1a5d0f5f998787/packages/durable/src/storage/sqlite/database.ts#L1-L38), [portable storage initialization and commits](https://github.com/earendil-works/pi/blob/6fb2e7815167e6b19006fc526d1a5d0f5f998787/packages/durable/src/storage/sqlite/storage.ts#L142-L203). Installed package declarations were also checked in `node_modules/@earendil-works/pi-durable/dist/storage/sqlite/`.

Required adapter behavior:

1. Normalize named row objects and supported SQL bindings without losing numbers, strings, nulls, or blobs.
2. Use `client.transaction('write')` for callbacks that read and write. Pi's generic transaction interface does not identify read-only callbacks, so a first adapter should not guess transaction mode from SQL strings.
3. Execute every callback query through the returned transaction object.
4. Commit only after the callback succeeds; propagate commit failures.
5. Roll back callback failures. If rollback also fails, expose that uncertainty rather than claiming guaranteed rollback.
6. Serialize unrelated operations and transaction callbacks. Invalidate transaction handles after the callback.
7. Close only after admitted operations drain.

Do not implement a transaction by issuing `client.execute('BEGIN')`, ordinary client queries, and `client.execute('COMMIT')`: ordinary HTTP executions create and close separate streams. The SDK's transaction object owns its persistent transaction stream.

Sources: [libSQL HTTP statement and transaction implementation](https://github.com/tursodatabase/libsql-client-ts/blob/9496c782af413f6380235c7f5d0c97b5371f49b7/packages/libsql-client/src/http.ts#L130-L255), [libSQL transaction interface and modes](https://github.com/tursodatabase/libsql-client-ts/blob/9496c782af413f6380235c7f5d0c97b5371f49b7/packages/libsql-core/src/api.ts#L309-L405), [Pi database facade contract](https://github.com/earendil-works/pi/blob/6fb2e7815167e6b19006fc526d1a5d0f5f998787/packages/durable/src/storage/sqlite/database.ts).

Pi's local Node adapter adds local WAL/checkpoint pragmas. Those are local adapter behavior, not requirements to copy into a remote libSQL adapter.

Source: [Pi Node adapter](https://github.com/earendil-works/pi/blob/6fb2e7815167e6b19006fc526d1a5d0f5f998787/packages/durable/src/storage/sqlite/node.ts).

## Local probe result

A `node --input-type=module` probe used the installed `@libsql/client` and Pi `SqliteStorage` against an OS temporary file, not Saul's databases. It supplied a serialized facade using libSQL transaction objects and asserted:

```text
PASS: Pi-Durable migrations over local libSQL
PASS: atomic records, entry reads, and request-ID lookup
PASS: transaction rollback
PASS: reopen preserves IDs and submission identity
```

This establishes local driver/SQL compatibility for these cases only. It does not establish:

- remote SQL/transaction compatibility for every storage operation;
- full storage conformance, document/fork/replay behavior;
- transaction duration limits of the selected cloud service;
- network failure recovery or ambiguous commit handling;
- streaming latency, query/bandwidth costs, or long-running workload performance;
- cross-process ownership or failover safety.

## Embedded replicas: optional later optimization

Legacy libSQL embedded replicas are not simply background uploads of a database edited by another driver.

With `@libsql/client`, `url` names the local replica and `syncUrl` names the cloud primary. By default:

- reads use the local replica;
- writes, including write transactions with reads, go to the cloud primary;
- the originating replica reads its own acknowledged writes;
- `sync()` pulls primary changes to the local replica;
- enabling `offline` allows local writes and changes the recovery guarantee.

Turso warns not to open the local file separately while the embedded replica is syncing. Therefore this is unsafe:

```text
Pi openNodeSqliteStorage -> edits local file
Separate libSQL client -> attempts to sync that same file
```

Both Pi reads and writes must use the same properly owned libSQL adapter. Periodically invoking `sync()` on a separate client does not turn Pi's current Node SQLite file into safe cloud storage.

Source: [official embedded replica documentation](https://docs.turso.tech/features/embedded-replicas/introduction).

Replicas can reduce ordinary read latency, but Pi's commits still involve cloud write transactions and reads within those transactions. They cannot eliminate all remote round trips. Start with direct remote mode to prove correctness and recovery, then measure whether replicas justify their additional lifecycle/configuration complexity.

Do not enable offline/local-first writes for the stated goal unless the user explicitly accepts loss of unpushed state if the VPS disk disappears.

## Safety and operational limits

### One active harness remains mandatory

Pi's ID allocation and execution lifecycle are process-owned. Database transaction locking does not provide agent leadership, coordination of in-memory state, or exclusive execution of tools.

The installed storage contract states: "One process owns a storage at a time; there is no cross-process locking."

Source: [Pi storage documentation](https://github.com/earendil-works/pi/blob/6fb2e7815167e6b19006fc526d1a5d0f5f998787/packages/durable/README.md#storage).

Cloud storage does not make ONCE's overlapping replacement containers safe. Keep stop-before-start deployment. On VPS replacement, ensure the old process cannot reconnect and resume alongside the new one; "the old VPS is unreachable" is not sufficient proof that it is dead.

### Remote commit uncertainty

A server may commit successfully while the connection fails before the client receives confirmation. Treat this as unknown, not as proof that nothing was written. Do not blindly retry arbitrary durable writes or external tool effects. Test whether the running session must be stopped and reconstructed from authoritative storage after such a failure.

The SDK documents the guarantee for a successfully resolved commit, not a guarantee that every rejected commit left the database unchanged.

Source: [libSQL transaction commit contract](https://github.com/tursodatabase/libsql-client-ts/blob/9496c782af413f6380235c7f5d0c97b5371f49b7/packages/libsql-core/src/api.ts#L348-L355).

### Cloud database is not a universal backup

Acknowledged cloud state is independent of the VPS disk. This does not cover unsent work, local files, lost encryption keys, deleted cloud records, provider/account failure, or an external side effect whose receipt was never durably saved.

- Preserve `SAUL_SECRETS_KEY` and signing secrets in a secure off-host location.
- Back up agent workspaces separately.
- Maintain S3 object backups/retention if attachments are enabled.
- Configure cloud recovery/retention and test restoration; retain independent exports where appropriate.
- Preserve exact user/conversation IDs during imports.

Sources: [Saul settings key contract](server-settings.md), [attachment backup requirements](attachments.md), [Saul ownership schema](../server/db/schema.ts).

### Performance must be measured

Pi commits perform several dependent SQL operations inside one transaction. A naive remote facade adds network round trips to those operations. That can affect task scheduling and live status updates even when a model call is slower than one SQL query.

Choose a database location close to the VPS and benchmark realistic turns, tools, reminders, and streaming. Verify service transaction limits against that workload. No exact transaction timeout or cost claim is established by the local probe.

## Safe migration plan

1. Finish account migrations and production bootstrap before changing the deployment's database URLs.
2. Build the libSQL facade behind Pi's existing storage interface; run facade and full storage conformance tests locally.
3. Run the same tests against a disposable remote libSQL-compatible Turso database, including dropped connections and commit-response loss.
4. Prove harness restart/resumption, request deduplication, forks, tools, and document recovery using fixture models.
5. Benchmark the remote path; keep one active harness.
6. Stop the existing installation and make consistent snapshots/exports of both databases. Preserve original files and deployment keys.
7. Import to distinct cloud databases without changing durable or account identities; verify schema versions and representative records.
8. Configure the cloud URLs/tokens and start exactly one Saul process. Verify authentication, saved conversations, ownership, settings decryption, attachments, and checkpoint recovery.
9. Retire the old process and prove the replacement-VPS procedure. Keep a documented rollback plan and never overwrite the last recoverable local copies during cutover.

Provisioning cloud accounts/credentials and the production cutover are separate human-authorized operations. They were not performed during research.
