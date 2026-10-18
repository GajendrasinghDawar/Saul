# Durable execution reliability

Saul adapts reliability patterns from [Pi-Durable on Cloudflare](https://earendil.com/posts/pi-durable-on-cloudflare/) without moving to Cloudflare. Express serves HTTP and server-sent events (SSE), Pi-Durable persists agent execution, and one VPS process owns the harness. App storage and Pi storage remain separate databases.

## 1. Retry commands, not side effects

A server can create a conversation successfully and lose the HTTP response. Previously, retrying New Chat could create another conversation.

The web client now saves a random `requestId` in localStorage before creating or forking a chat. The key includes the authenticated user and operation path. Network failures and server errors get one immediate retry with the same ID. If the outcome remains uncertain, the saved ID survives a reload; repeating the action reuses it. Success clears it so the next intentional action gets a new ID. Validation, not-found, and command-conflict responses clear it. Authentication/CSRF failures, timeouts, and rate limits retain it: rejection of a later attempt does not prove that an earlier attempt failed.

In `server/services/chat.ts`, a session-scoped `saul.conversation-command` document records the result under `[userId, requestId]`. Conversation creation or branching and the receipt commit together in Pi storage. Repeating that command returns the original numeric conversation ID. Reusing its ID for another command is a conflict. Forks still require ownership of the source conversation.

There is no transaction spanning the two databases:

```text
Pi commit: conversation + command receipt
                    |
App insert: conversation ownership and initial title
                    |
Pi commit: receipt marked published
                    |
HTTP success: client clears pending request ID
```

If the app insert fails after Pi commits, retrying the same command repairs ownership instead of creating another chat. The insert does not overwrite a renamed title. Publication rereads the receipt inside a serialized Pi commit, so a delayed duplicate cannot use an unpublished copy to restore a chat deleted after successful publication. A published receipt whose app conversation was deleted returns a conflict. The app write runs while that Pi commit is held, so app-database latency delays other Pi commits. If the process fails before the publication marker commits, repair cannot distinguish a removed ownership row from an interrupted insert; there is no app-side deletion tombstone.

This is retry-driven repair, not a startup reconciliation scan. Clearing browser storage can lose a pending command ID. Clients outside the web UI must supply and retain their own ID to get the same guarantee; omitted IDs get a new server-generated UUID. Existing message submission deduplication continues to use Pi's submission request IDs.

## 2. A failed harness must not keep serving agent requests

`server/setup/durable.ts` installs Pi's `onReport` callback and calls `harness.resume()` on boot. Background failures produce a categorized log event, without dumping provider errors, credentials, prompts, or checkpoints.

The app exposes two different probes:

| Route | Meaning |
| --- | --- |
| `GET /health` | HTTP process is alive. |
| `GET /ready` | Harness is open: 200 `ready`; after closure: 503 `unavailable`. |

Readiness is not a periodic database query or a provider availability check. Auth routes remain separate; remaining `/api` routes reject requests after the harness closes. A single failed model task does not necessarily close the harness.

Pi 1.2 exposes fatal storage failure through `harness.closed`. `server/server.ts` logs `durable.failed` and exits with code 1 on this terminal failure. The supervisor must restart the process to reopen persistent state. The existing Docker Compose service uses `restart: unless-stopped`; other hosting arrangements need an equivalent restart policy. A health probe by itself does not restart Docker containers.

After restart, pending approvals, scheduled reminders, and replay-safe tasks resume without opening a chat or sending a new message. This does not recover data that never committed or repair a permanently unavailable database. Watch for restart loops and fix the underlying storage issue.

## 3. Recover subagent commands without duplicate children

`manage_subagents` supports `spawn`, `send`, and `status`, and is replay-safe. In `server/agent/subagents/manager.ts`, the tool task ID identifies its saved reporter. The registry update, child/anchor creation when spawning, and reporter task creation share a Pi commit.

If execution stops after that commit but before the tool result is saved, replay finds the reporter and returns the same child ID. It does not create a second child or enqueue the same request again. A different spawn task using an existing name still fails and must use `send`. Reporters already use stable submission request IDs for delivery to the child and back to its parent.

Cancellation is deliberately separate: `stop_subagent` is replay-unsafe. Repeating an old cancellation could stop newer work on the same child, and conversation abort has no deduplication key. An interrupted unsafe tool remains subject to Pi's unsafe-tool recovery behavior; do not describe cancellation as exactly-once.

## 4. Live Tasks use the task graph

`GET /api/tasks/stream` opens `harness.watchTaskGraph()`. It sends an initial snapshot and refreshes the user's task list when the graph changes. The web Tasks page uses EventSource instead of polling every two seconds. After disconnection EventSource reconnects and gets a fresh snapshot, so no event cursor is needed.

The global graph never goes directly to a browser. Each frame rechecks app ownership through `TaskService.getUserTasks`. Both the list endpoint and SSE expose only task ID, kind, conversation ID, cancellation flag, execution status, and terminal outcome status. Inputs, checkpoints, results, and raw errors are excluded. Completed tasks remain visible in the task scan.

The stream suppresses identical snapshots, waits for writable-buffer drain, sends a 15-second heartbeat, and stops its watcher when the connection closes. Reverse proxies must permit streaming; the response disables proxy buffering where supported. Ownership changes in app storage are reflected on the next graph-triggered snapshot or reconnect, not through a separate app-database change feed. Full scans per snapshot favor simplicity; large task histories may eventually need pagination.

## 5. Recovery checks

Tests use disposable local databases and Pi AI's faux provider, not real credentials or paid model calls:

- `server/test/conversation-commands.test.ts`: duplicate commands, forks and authorization, interrupted app ownership writes, SQLite reopen, boot-time reminder recovery, closed/fatal harness readiness, owned SSE transitions, cancellation, and reconnect. Runs against Node SQLite and local libSQL.
- `server/test/subagents-recovery.test.ts`: interrupt after the real spawn/send operation, and after reporter submissions but before checkpoints; close and reopen SQLite, then check stable results, child and reporter counts, and single deliveries to child and parent.
- `web/test/conversation-commands.test.ts`: lost response and expired-auth retries reuse the ID; confirmed actions and different users use different IDs.
- Existing approval-resume, chat-safety, storage conformance, and message-outbox suites remain regression coverage.

Run from the repository root with a current Node 24 LTS (some existing tests need newer Node assertions):

```powershell
$tests = @(Get-ChildItem server/test/*test.ts, web/test/*test.ts | ForEach-Object FullName)
node --test $tests
node_modules/.bin/tsc.cmd --noEmit
npm.cmd run build --prefix web
```

These tests validate local reopen and injected failures, not a remote Turso outage, actual host power loss, or production supervisor operation. Test those operational scenarios on disposable infrastructure before claiming full disaster-recovery coverage.

## Upgrade and operations

This change upgrades Pi-Durable, Pi AI, and Chord to 1.2. Tool implementations now return `output` rather than the old `content` field. Pi AI renamed its built-in Azure provider to `azure`; the API family remains `azure-openai-responses`. Startup migrates the encrypted credential and saved default, then updates existing conversation model references before resuming execution. The Pi migration has a durable completion marker and can continue after an interrupted boot. Use `SAUL_AI_PROVIDER=azure` for new environment configuration. Back up both databases and encryption keys before upgrades; test the release against copies first. Do not downgrade databases without checking Pi's schema compatibility.

Keep exactly one backend instance active against a Pi database, including during VPS replacement. Persistent agent state is not an exactly-once guarantee for arbitrary external services: use provider idempotency keys for effects such as email, and retain the existing approval/outbox safeguards. Database persistence also does not preserve workspace files, attachment objects, or encryption keys. See [storage configuration](pi-libsql-storage.md), [chat delivery](chat-delivery.md), and [attachment backups](attachments.md).
