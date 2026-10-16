# Deployment readiness: Campfire patterns for Saul

## Recommendation

Ship Saul as a prebuilt, versioned application image. Use Docker Compose and Caddy for the first production release, with one local persistent volume and an explicit stop-before-start update flow. Follow Campfire's packaging, first-run onboarding, startup migrations, and backup ergonomics. Do not introduce a custom deployment platform.

ONCE is a possible later deployment adapter, not a safe drop-in update manager today: its normal replacement flow briefly runs old and new containers against the same volume, while Pi-Durable explicitly requires a single process per storage.

This is an inspection and proposed plan, not a completed production release. No running installation, database, secret, or deployment configuration was changed.

Subsequent requirement: the owner wants database state to survive losing or replacing the VPS. The local-volume layout below is the original baseline, not sufficient for that requirement. See [Turso and Pi-Durable review](turso-pi-durable-review.md) for a proposed cloud-authoritative account and agent storage path. Validate the remote adapter before adopting it; the single-active-process and safe update requirements remain unchanged.

## Sources inspected

- Local Campfire checkout: `C:/Users/dawar/projects/repos/once-campfire`, revision `edbc779f4dfc9b26c36310881711ddc976a9dfc8`.
- ONCE upstream checkout, revision `864ec7c61ebeb11ede79dbe6eef1beb5b4cbe19f`.
- Saul working tree after `d609acf`, including existing uncommitted README and settings changes.
- Installed Pi-Durable README and declarations. The application uses its Node SQLite adapter.

Findings below cite owning source files rather than treating Saul's older deployment documentation as current behavior.

## 1. What makes Campfire easy to deploy

### A prebuilt application, not a source-code deployment

Campfire publishes container images for `linux/amd64` and `linux/arm64`. Release tags produce stable version tags and `latest`; `main` is a separate less-stable track. Assets are built before shipping. The final image runs as a non-root user and includes its web app and background workers.

Sources: [Campfire self-hosting guide](https://github.com/basecamp/once-campfire/blob/edbc779f4dfc9b26c36310881711ddc976a9dfc8/docs/self-hosting.md), [image publishing workflow](https://github.com/basecamp/once-campfire/blob/edbc779f4dfc9b26c36310881711ddc976a9dfc8/.github/workflows/publish-image.yml), [Dockerfile](https://github.com/basecamp/once-campfire/blob/edbc779f4dfc9b26c36310881711ddc976a9dfc8/Dockerfile), [Procfile](https://github.com/basecamp/once-campfire/blob/edbc779f4dfc9b26c36310881711ddc976a9dfc8/Procfile).

### One explicit persistent storage location

Campfire puts its production SQLite database and uploaded files in `/rails/storage`. Replacing the container does not replace the volume. Its Docker build excludes local storage, environment files, and development credentials.

Sources: [self-hosting guide](https://github.com/basecamp/once-campfire/blob/edbc779f4dfc9b26c36310881711ddc976a9dfc8/docs/self-hosting.md), [database configuration](https://github.com/basecamp/once-campfire/blob/edbc779f4dfc9b26c36310881711ddc976a9dfc8/config/database.yml), [.dockerignore](https://github.com/basecamp/once-campfire/blob/edbc779f4dfc9b26c36310881711ddc976a9dfc8/.dockerignore).

### Boot prepares the database; the browser creates the administrator

`bin/start-app` runs `rails db:prepare` before serving requests. The first-run controller guides the first administrator through setup and prevents repeats once an account exists. Users do not run a development schema synchronizer to initialize a production instance.

Sources: [bin/start-app](https://github.com/basecamp/once-campfire/blob/edbc779f4dfc9b26c36310881711ddc976a9dfc8/bin/start-app), [first-run controller](https://github.com/basecamp/once-campfire/blob/edbc779f4dfc9b26c36310881711ddc976a9dfc8/app/controllers/first_runs_controller.rb).

### Backup and restore are part of the application contract

Campfire's `/hooks/pre-backup` delegates to a SQLite online snapshot command. `/hooks/post-restore` restores that snapshot before boot and removes obsolete WAL/SHM files. Manual deployment documentation explains volume backups and stable secrets across restores.

Sources: [pre-backup hook](https://github.com/basecamp/once-campfire/blob/edbc779f4dfc9b26c36310881711ddc976a9dfc8/hooks/pre-backup), [snapshot command](https://github.com/basecamp/once-campfire/blob/edbc779f4dfc9b26c36310881711ddc976a9dfc8/script/admin/prepare-backup), [post-restore hook](https://github.com/basecamp/once-campfire/blob/edbc779f4dfc9b26c36310881711ddc976a9dfc8/hooks/post-restore), [self-hosting guide](https://github.com/basecamp/once-campfire/blob/edbc779f4dfc9b26c36310881711ddc976a9dfc8/docs/self-hosting.md).

## 2. What ONCE adds, and why it is not the first rollout choice

ONCE is a separate deployment manager, not something embedded in Campfire. It accepts custom images, manages a proxy, installs a background service, and provides updates and backups.

Its minimal application contract is:

- Serve HTTP on port 80.
- Return success at `/up`.
- Keep persistent data in `/storage`.
- Optionally provide `/hooks/pre-backup` and `/hooks/post-restore`.

It passes `BASE_URL` and an installation-stable `SECRET_KEY_BASE` to applications. It also supports arbitrary application environment settings. Its proxy uses `kamal-proxy` and enables TLS when appropriate. The same volume is mounted at `/storage` and `/rails/storage`.

Sources: [ONCE README](https://github.com/basecamp/once/blob/864ec7c61ebeb11ede79dbe6eef1beb5b4cbe19f/README.md), [application configuration](https://github.com/basecamp/once/blob/864ec7c61ebeb11ede79dbe6eef1beb5b4cbe19f/internal/docker/application.go), [proxy](https://github.com/basecamp/once/blob/864ec7c61ebeb11ede79dbe6eef1beb5b4cbe19f/internal/docker/proxy.go).

### Important incompatibility: overlapping processes during updates

ONCE's `deployWithVolume`:

1. Creates a new container mounting the existing application volume.
2. Starts that container.
3. Deploys it through the proxy and waits for health.
4. Removes old containers only after proxy deployment succeeds.

Pi-Durable's storage documentation says: "One process owns a storage at a time; there is no cross-process locking."

The overlap is therefore not safe for Saul's current architecture. It can produce competing task execution or conflicting durable state; a healthy HTTP endpoint does not prove safe storage ownership. Settings changes also use the replacement flow, so disabling automatic updates alone does not solve it.

Sources: [ONCE deployment implementation](https://github.com/basecamp/once/blob/864ec7c61ebeb11ede79dbe6eef1beb5b4cbe19f/internal/docker/application.go#L332-L403), [installed Pi-Durable storage contract](../node_modules/@earendil-works/pi-durable/README.md#storage), [Saul harness startup](../server/setup/durable.ts), [single-process signup serialization](../server/app.ts).

For a later ONCE integration, verify an operational stop-before-start policy for every replacement, or implement a tested process-ownership/handoff mechanism. Do not promise ONCE compatibility based only on its port/path requirements.

### Backup scope matters

ONCE archives application settings and the mounted volume. Without a successful pre-backup hook it pauses the container while copying. It does not automatically back up Saul's external S3 objects or a remote Turso database. Its archives include configured secrets and must be protected accordingly.

Sources: [ONCE backup implementation](https://github.com/basecamp/once/blob/864ec7c61ebeb11ede79dbe6eef1beb5b4cbe19f/internal/docker/application_backup.go), [Saul attachment backup requirements](attachments.md), [settings key requirements](server-settings.md).

## 3. Saul's current release blockers

| Area | Current behavior | Required change |
| --- | --- | --- |
| Image hygiene | No root `.dockerignore`; builder uses `COPY . .` after dependency installation. Local `.env`, databases, and host `node_modules` can enter build layers or overwrite installed dependencies. | Exclude credentials, databases, logs, build artifacts, host dependencies, and agent state. Copy runtime files explicitly. |
| Runtime | Image runs as root, installs build tools in the runtime stage, and installs unpinned global `tsx`. | Tested supported Node LTS, native TypeScript entrypoint, non-root runtime, production-only artifacts. Audit unused native dependencies. |
| First boot | Settings loading queries the account database before serving. There is no startup migration runner. | Validate bootstrap, create storage, run versioned migrations, load settings, open harness, then serve. |
| Schema completeness | Checked-in migrations omit `user.role` and `deviceCode` present in the declared schema. | Complete and test migrations for fresh installations and supported existing schema states. Do not run interactive `drizzle-kit push` in production. |
| Credentials | Startup validation only warns about missing signing secrets; `.env` overrides injected environment values. | Fail closed for required bootstrap configuration. Load development `.env` with Node built-ins; production configuration must not be silently overwritten. |
| Optional integrations | Production validation includes Resend even though mail is an optional feature. Model and attachment configuration already have Settings support. | Keep email, S3, and model services optional for opening the UI; show explicit capability/configuration errors when used. |
| Health and shutdown | `/health` returns a static success response; server entrypoint has no SIGTERM/SIGINT shutdown sequence. | Readiness after successful initialization; graceful HTTP/SSE shutdown and harness/storage cleanup with a bounded deadline. |
| Deployment safety | Scripts hard-code one IP. Bash uploads local `.env`; PowerShell archives the working tree and invokes `docker system prune -af --volumes`. Both stage/commit/push all changes. | Replace with target-independent pull/recreate operations. Never copy developer data/secrets, delete volumes, or manipulate Git as a deploy side effect. |
| Backup/restore | There are explanatory docs but no shipped, tested end-to-end backup command. | Back up both local databases at a consistent stopped boundary, deployment secrets, and referenced external objects. Prove restore. |
| Release validation | There is no checked-in image publishing workflow in the current workflows directory. | Test and publish versioned images; smoke-test an empty volume, restart, update, and restore before release. |

Sources: [Dockerfile](../Dockerfile), [Compose](../docker-compose.yml), [Bash deploy](../deploy.sh), [PowerShell deploy](../deploy.ps1), [account DB setup](../server/db/index.ts), [settings startup](../server/setup/settings.ts), [environment validation](../server/setup/env.ts), [server entrypoint](../server/server.ts), [HTTP app](../server/app.ts), [account schema](../server/db/schema.ts), [first migration](../server/drizzle/0000_fixed_gwen_stacy.sql), [second migration](../server/drizzle/0001_powerful_texas_twister.sql), [package scripts](../package.json).

The old [deployment guide](deploy.md) describes a different script flow from the current Bash script. The [troubleshooting guide](self-hosting-troubleshooting.md) recommends startup schema push and describes code that has since changed. Rewrite these once the supported release contract is implemented.

## 4. Smallest safe operator experience

### Initial installation

1. Rent a Linux server, install Docker, and point a domain at it.
2. Obtain a small Compose release bundle, not the source tree.
3. Run one setup command that asks for the domain and writes owner-readable production configuration. Generate independent signing/encryption secrets once on that server; never regenerate them during restart/update. Keep a separate secure copy.
4. Start the application and Caddy from prebuilt, pinned images.
5. Open HTTPS, authorize first setup with a one-time installation token, create the first administrator, and configure the model in Settings. S3 and mail remain optional. Public first-account-wins registration must not let an unrelated visitor claim a newly exposed instance.

The setup command and published Saul image do not exist yet; this describes the target behavior.

### Runtime layout

```text
Internet -> Caddy (HTTPS) -> Saul (one Node process)
                                |
                                +-- /storage/accounts.sqlite
                                +-- /storage/agent.sqlite
                                +-- /storage/workspace/  (if filesystem tools use it)
```

Bootstrap secrets are external deployment configuration, not database rows. The existing database filenames can be retained; the example shows responsibilities, not a required file migration. Both database paths must resolve inside the configured durable storage directory. Keep one writable application container per volume.

Prefer local SQLite for the documented baseline. Remote Turso and S3 are separate advanced configurations with separate recovery requirements. A working text assistant must not require provisioning either service.

### Update

```text
Pull the selected release while the old app stays online
-> stop Saul and close/checkpoint its databases
-> back up local state and deployment configuration
-> start the new image with the same volume and keys
-> apply reviewed migrations
-> wait for readiness
-> verify sign-in and saved history
```

Caddy can remain running. A brief maintenance window is acceptable; overlapping agent processes are not. Serialize update/backup/restore commands. Disable autonomous image updaters until their replacement policy has been verified.

A previous image alone is not always a valid rollback after schema changes. Keep a pre-update backup and document whether rollback is image-only or requires restoring data; a restore can discard writes made after that backup.

### Backup

For the first release, prefer a short stopped backup over independently timed online snapshots of two databases. Capture both databases and any required WAL/SHM files from the same quiescent state, plus deployment configuration in a protected archive. Test restoring to a fresh volume with the same encryption/signing keys. Copy backups off-host. Document external attachment backup separately.

Online snapshot hooks are optional later work, not necessary to achieve a simple reliable first release.

### Security defaults

- Publish only proxy ports; do not expose the backend directly when trusting proxy headers.
- Require HTTPS for public installations; verify authentication, CSRF cookies, and SSE through the actual proxy.
- Run as non-root with a writable data directory and bounded log rotation.
- Restrict agent filesystem/process capabilities to intentional workspaces. Never mount the Docker socket or the whole host filesystem to make setup easier.
- Exercise Node's Permission Model against the actual runtime dependencies and explicitly granted tool capabilities before making it the production entrypoint.
- Validate required keys and public URL before readiness; preserve existing installation keys.
- Protect public first-admin provisioning with a one-time setup credential and consume it atomically. The current first-account-wins rule closes registration after setup but does not prove that the first visitor is the intended owner.
- Use a verified configurable email sender before advertising password-reset email as working. Current auth code uses the Resend onboarding address.

Sources for current trust and mail behavior: [HTTP app](../server/app.ts), [auth](../server/auth/auth.ts), [security middleware](../server/middleware/security.ts).

## 5. Implementation order and release gates

### Phase 1: make first boot real

- Complete versioned account migrations and add a non-interactive startup runner.
- Define one storage directory and external bootstrap configuration contract.
- Ensure migrations happen before settings queries.
- Make missing required keys fail with actionable, secret-free messages.
- Keep the browser's first-admin flow, protect installation claiming, and show explicit missing-provider setup guidance.

**Gate:** an empty installation starts without manual SQL; setup creates exactly one administrator; restart preserves users, settings, and conversations.

### Phase 2: package a reproducible runtime

- Add `.dockerignore` and tighten build/runtime copies.
- Use native Node TypeScript and production-only runtime dependencies.
- Run non-root; verify storage permissions.
- Add readiness and bounded graceful shutdown.
- Verify permission grants and proxy streaming behavior.

**Gate:** built image boots from a fresh volume and restarts safely during a fixture agent task, without a real paid model call.

### Phase 3: make operations safe

- Replace hard-coded deploy scripts and unsafe pruning/Git operations.
- Ship a small Compose release bundle and setup command.
- Add serialized stop-before-start update, backup, and restore commands.
- Preserve secrets; reject reset/destructive operations without explicit intent.
- Pin application releases and proxy version; configure bounded logs.

**Gate:** update never overlaps app processes, preserves state, and has a tested recovery path.

### Phase 4: publish releases

- CI runs type checks, deterministic tests, web build, and image smoke tests.
- Publish versioned GHCR images; validate amd64 and arm64 before claiming both.
- Document fresh install, update, restore, HTTPS, optional services, and storage limits.
- Test the full operator flow on a disposable Linux host.

**Gate:** a human can deploy from the release bundle without installing Node, npm, a compiler, Turso, or cloning the source; restore recovers both history and ownership/settings.

## Not needed for the first release

Kubernetes, multi-host execution, Redis, a custom deployment daemon, automatic rolling updates, a custom certificate manager, and zero-downtime migrations. Those add new operational contracts without resolving the current first-boot and recovery blockers.
