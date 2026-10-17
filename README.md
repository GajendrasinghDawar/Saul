# Saul

Saul is a personal AI assistant for conversations, tasks, reminders, and context. You can use it on the web and on Android. Saul helps you turn plans into actions. It can send Android notifications and scheduled check-ins.

core idea of saul is that it runs on vps with os acccess and you can access it from anywhere and bend it to your requirement add features of your liking

## What it provides

- Multi-device access through the web client and Android app.
- Saved conversations and task workflows.
- Scheduled reminders and briefings.
- Optional file attachments with private S3-compatible storage.
- Local development with SQLite and Pi-Durable execution history.

This repository is an active personal project. Some features need external services. The instructions in this file describe local development. They are not production deployment instructions.

## Repository layout

- `server/`: backend code, database schema, `drizzle.config.ts`, and generated migrations in `server/drizzle/`.
- `web/` and `android/`: client code and client-specific build configuration.
- `docs/`: architecture, setup, and learning material.
- Root `package.json` and its lockfile: backend dependencies and commands that run both clients and server tooling. Keep them here until the backend becomes a separate package.
- Root `biome.json`, `tsconfig.json`, `.gitignore`, `.agents/`, `.github/`, `AGENTS.md`, and `README.md`: repository tooling and guidance. The root TypeScript config currently checks the backend.
- Root `Dockerfile`, `docker-compose.yml`, and deploy scripts: deployment of the backend and built web client together.
- Root `.env`: untracked bootstrap configuration. Run development and database commands from the repository root.
- `data/`: local runtime databases, not source code. Database files and logs do not belong in the tracked root. Keep existing files until their use and backup requirements are known; a folder move must not move or delete runtime data.

## Documentation

- [Local setup](#local-setup-windows-powershell)
- [Manual web checks](#manual-web-checks)
- [S3-compatible attachments](#s3-compatible-attachments)
- [Android local testing](#android-real-local-testing)
- [Android implementation guide](docs/android-client-implementation-guide.md)
- [Server settings](docs/server-settings.md)
- [Attachment storage and backups](docs/attachments.md)
- [Pi-Durable libSQL storage trial](docs/pi-libsql-storage.md)
- [Durable execution reliability](docs/durable-reliability.md)

## Local setup (Windows PowerShell)

Run the commands from the repository root. Replace each `<...>` placeholder. Keep existing configuration and data. Do not reset an installation to follow this guide.

### Prerequisites

- Node.js 22.19 or newer supported LTS, and npm. Pi-Durable needs Node.js 22.19 or newer. Tests use native TypeScript. The backend uses Node SQLite.
- Root and web dependencies. Run these commands only for a new checkout:

```powershell
Set-Location 'C:\Users\dawar\projects\Saul'
npm ci
npm ci --prefix web
```

Android needs Android Studio/SDK, SDK platform 37, platform-tools, and JDK 17. The current checkout uses `C:\Users\dawar\.jdks\jbr-17.0.14`. Use the path to your own JDK. See [Android toolchain](android/README.md) for version checks.

### Bootstrap configuration

Create or edit the untracked root `.env` file. Never commit real secrets. The backend loads it with Node's `process.loadEnvFile()`. Existing process environment values take priority over `.env` values.

```dotenv
NODE_ENV=development
BETTER_AUTH_URL=http://localhost:3000
BETTER_AUTH_SECRET=<independent-random-auth-secret>
COOKIE_SECRET=<independent-random-cookie-secret>
CSRF_SECRET=<independent-random-csrf-secret>
SAUL_SECRETS_KEY=<64-hex-character-key-generated-once>
```

Set the signing secrets even though bootstrap validation only warns when they are missing. The default auth URL is `http://localhost:3000`. The default `PORT` is `3000`. Generate each secret with:

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Generate `SAUL_SECRETS_KEY` **once per installation** with that command. It must contain exactly 64 hexadecimal characters. Keep it outside the database and the Settings UI. Store a separate backup in a secure password manager. Reuse the same key after a restart or restore. If you lose or replace the key, Saul cannot read saved settings and may not start. An empty settings table can start without the key, but every Settings write needs it. Do not generate a new key for an existing installation.

Optional service configuration:

- Configure chat in **Settings**: choose a Pi AI provider, complete its API-key or supported account login, then select a default model. Built-in providers include OpenAI, Anthropic, Google, Azure and Amazon Bedrock. Pi's native environment and credential-file sources remain supported. Settings requires administrator access; model availability still depends on your provider account.
- For a custom endpoint, add a connection using its Pi API family and actual model metadata. No model is selected implicitly. Optionally bootstrap a built-in default with `SAUL_AI_PROVIDER` and `SAUL_AI_MODEL`, plus that provider's environment credentials. These only initialize an installation without saved AI configuration. Existing Azure deployment environment configuration is also recognized. See [AI configuration](docs/server-settings.md).
- `RESEND_API_KEY` enables email, including password reset. `MY_EMAIL_ADDRESS` sets the reminder and digest recipient; password resets go to the account email. Both values come only from `.env` or injected environment variables. Basic email/password sign-in does not need a Resend key.
- S3 settings enable attachments. They are not needed for text chat. See [S3-compatible attachments](#s3-compatible-attachments).
- Remote database credentials are used only in production. Development and tests ignore remote database URLs and tokens. See [database setup](#database-setup) and [Pi storage configuration](docs/pi-libsql-storage.md).

Configure email and attachment storage in the untracked root `.env` file (use your provider's actual values):

```dotenv
RESEND_API_KEY=<resend-api-key>
MY_EMAIL_ADDRESS=<reminder-and-digest-recipient>
S3_ENDPOINT=https://<s3-compatible-endpoint>
S3_REGION=<signing-region>
S3_BUCKET=<bucket-name-or-appwrite-bucket-id>
S3_ACCESS_KEY_ID=<access-key-id-or-appwrite-project-id>
S3_SECRET_ACCESS_KEY=<secret-access-key>
```

Restart the backend after changing `.env`. Omit services you do not need. Storage and email settings cannot be read or changed through the AI management API; old database overrides are retained but ignored. Before upgrading an installation configured only through the UI, put its working infrastructure values in `.env` or deployment secrets. No credentials are copied or deleted automatically.

The raw environment-variable settings API has been removed. Old Azure UI rows are retained but ignored: reconnect the provider through Settings or configure its environment credentials. Native Pi credentials, custom catalogs and the chosen default are encrypted in the app database. UI changes apply live; new chats use the current default while existing chats keep their saved model. Keep bootstrap and database credentials outside Settings.

### Database setup

`npm run dev` forces `NODE_ENV=development`, even if `.env` or the terminal says production. The default local databases are:

- App: `data\saul-app.dev.sqlite`.
- Pi: `data\saul-pi.dev.sqlite`.

Startup creates the local directory and databases, applies checked-in app migrations, then loads Settings and auth. Pi initializes its own schema when the harness opens. Restart applies only pending migrations; it does not reset data or seed accounts. No manual schema push is needed.

Remote URLs in `SAUL_APP_STORAGE_DATABASE_URL` and `SAUL_DURABLE_STORAGE_DATABASE_URL` are ignored outside production, and their tokens are never passed to local clients. A `file:` URL can override a development database for isolated testing. Existing `local-turso.db` and `lali-durable.sqlite` files are not deleted or imported into these new development databases. A fresh development database needs a new local account.

For production, set all four values and `NODE_ENV=production` in the deployment environment:

```dotenv
SAUL_APP_STORAGE_DATABASE_URL=libsql://<app-database-host>
SAUL_APP_STORAGE_DATABASE_TOKEN=<app-database-token>
SAUL_DURABLE_STORAGE_DATABASE_URL=libsql://<pi-database-host>
SAUL_DURABLE_STORAGE_DATABASE_TOKEN=<pi-database-token>
```

Production requires two distinct remote libSQL databases and their tokens. Missing or local database configuration stops startup instead of falling back to local files. Keep one active Saul process, including during replacement. App migrations run before Settings or auth; Pi migrations run before the harness becomes available. This is a direct remote connection, not local-file sync. Database storage alone does not preserve agent workspace files or encryption keys.

When changing `server/db/schema.ts`, generate and inspect a migration before release:

```powershell
npm run db:generate -- --name=describe_change
npm run db:check
```

These commands force development mode and do not apply database changes. Migration SQL and snapshots live in `server/drizzle/`; commit them with the schema change. Startup applies reviewed files, never generates them. `db:push` is removed and direct Drizzle schema push through the project config is disabled. `db:seed` is optional, development-only example data; it does not create an account.

For an **existing installation**, back up both databases and keys before deploying migrations. Test each upgrade on a backup first, and review SQL for destructive changes. Automatic migration is not an automatic guarantee that future SQL is safe. An old database created with schema push may lack migration history: startup refuses conflicting tables instead of guessing a baseline or deleting data. Changing URLs does not import accounts, Settings, or Pi history. Existing users are not promoted automatically.

### Start development

```powershell
npm run dev
```

This starts the backend in development mode (`tsx watch server/server.ts`) and Vite together. You can also run `npm run dev:backend` and `npm run dev:web` in separate terminals. Press Ctrl+C to stop them. AI changes in Settings apply without a restart; changes to `.env` require restarting the backend.

- Web: `http://localhost:5173`. If this port is busy, use the URL that Vite prints.
- Health check: `http://localhost:3000/health`.
- Agent readiness: `http://localhost:3000/ready`.
- Vite proxies `/api`, `/csrf-token`, `/health`, and `/ready` to `http://localhost:3000`. If you change the backend port, update the proxy too.

Vite binds to all interfaces. Use a trusted local network. Do not expose this development setup to the public internet.

## Manual web checks

1. Open the web client. On an empty installation, create the first account. Saul makes this account an administrator. Public registration then closes. Only an authenticated administrator can create more users. On an existing installation, use an existing account.
2. Sign out and sign in. Check the conversation list. Create, rename, and select a test conversation. Open Tasks. These checks do not need a model call.
3. As an administrator, open Settings. Search providers, configure credentials using a native login, and select a model. Storage and email must not have edit controls, and saved keys must never be displayed. On a disposable installation, add a custom connection and verify it survives a restart. A non-administrator must not access AI management. Do not replace working credentials only for testing.
4. Create a new chat and send a short message only when provider usage is acceptable. Check streaming and history after reload. Change the default on a disposable installation: a new chat must use it, while the earlier chat keeps its model. Check the transcript before retrying an unclear send error. OAuth flows requiring a localhost callback run on the server host; use a native manual code/URL prompt where offered.

## S3-compatible attachments

Create a **private** bucket. Create dedicated server credentials with permission to put and get objects under `saul/attachments/*`. Saul does not create buckets. Do not make files public. Do not put server credentials in clients. Set these environment variables in `.env` or deployment secrets, then **restart the backend**:

| Setting                | AWS S3                                  | Cloudflare R2                                   | Appwrite S3-compatible storage                                          |
| ---------------------- | --------------------------------------- | ----------------------------------------------- | ----------------------------------------------------------------------- |
| `S3_ENDPOINT`          | `https://s3.<aws-region>.amazonaws.com` | `https://<account-id>.r2.cloudflarestorage.com` | `https://<region>.cloud.appwrite.io/v1/s3`, using your project's region |
| `S3_REGION`            | Actual bucket region, e.g. `us-east-1`  | `auto`                                          | Project region, e.g. `nyc`, or `auto`                                   |
| `S3_BUCKET`            | Actual bucket name, not ARN             | Actual bucket name, not account ID              | Actual bucket **ID**, not display name or project ID                    |
| `S3_ACCESS_KEY_ID`     | Dedicated IAM access key ID             | R2 S3 access key ID                             | Appwrite project ID                                                     |
| `S3_SECRET_ACCESS_KEY` | Matching IAM secret                     | Matching R2 secret                              | Appwrite API key secret from that same project                          |

Use actual console identifiers. Do not use placeholders. For Appwrite, use a dedicated API key with `buckets.read`, `files.read`, `buckets.write`, and `files.write` scopes. Project ID, bucket ID, and display name are different values. Confirm the endpoint in your project's S3 connection instructions. Bucket IDs must pass Saul's current lowercase S3-style validation: 3–63 characters; use only letters, digits, dots, and hyphens; do not use consecutive dots.

For a dedicated Appwrite bucket, set **encryption disabled** and **compression None**. Set the maximum file size to **at least 5 MiB (5,242,880 bytes)**. Keep the bucket private. Leave the allowed-extension list unrestricted. Saul uses random IDs for object keys, not filename extensions. Saul validates file type and size. If an existing bucket contains important files, create a separate bucket. Do not change its encryption settings. The server reads metadata from authenticated **GET headers**. It does not buffer the response body. This supports the observed Appwrite HEAD 403 and GET 200 behavior. A HEAD denial alone does not show that GET is broken.

The client uses path-style requests. Use HTTPS except for HTTP loopback in local development. If storage configuration is missing, uploads are disabled. Text chat remains available.

Limits are as follows:

- A message can contain up to four different files.
- PNG, JPEG, and WebP files must be non-empty and no larger than 5 MiB each.
- UTF-8 text, Markdown, CSV, and JSON files must be non-empty and no larger than 64 KiB each.
- File bodies in the active model context can total up to 20 MiB.
- Images need an image-capable model.
- PDF, office, audio, and video files are not supported.

### Test your real provider

1. Set the storage environment variables and restart the backend.
2. Upload a small `.txt` file and a supported image in a test conversation. Check the filenames. Upload does not need a model call.
3. When provider usage is acceptable, send the text file and ask for a summary. If the deployment supports images, send the image and ask about its contents. Confirm a real response. Upload success alone is not enough.
4. Download the attachments in the web client. Compare the bytes and names with the original files. Repeat the test in Android with the system save picker.
5. Reload the chat. Reopen the chat. Restart the backend. Confirm that existing files still download.
6. Try an unsupported or oversized file. Confirm that Saul shows an explicit error and keeps the draft. Do not use confidential files.

S3 does not replace the databases. Accounts and ownership use the account database. History and checkpoints use Pi SQLite. Back up both databases, all objects, and the separate encryption key together. A new email account does not recover objects owned by the old account ID.

Changing providers is **not** a configuration-only migration. Before you change settings or restart, copy objects with the same keys, content types, and filename metadata. Do not expire files referenced by chats or forks. See [attachment storage and backups](docs/attachments.md).

## Android: real local testing

Use ADB reverse for both the backend and web ports. Device authorization opens the web client in the phone browser. Use paths for your installations. Keep the backend and web client running.

```powershell
$env:JAVA_HOME = '<path-to-compatible-Gradle-JDK>'
$adb = "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe"
& $adb devices -l
```

For USB, enable Developer options and USB debugging. Connect the phone. Accept the authorization prompt. Set `$device` to the serial shown by `devices -l`.

For wireless ADB on Android 11 or newer, connect the computer and phone to the same trusted Wi-Fi. Enable Wireless debugging. Open **Pair device with pairing code**. Pairing and connection ports can change. Use the current phone values:

```powershell
& $adb pair '<phone-ip>:<pairing-port>'
# Enter the pairing code when prompted.
& $adb connect '<phone-ip>:<connection-port>'
$device = '<phone-ip>:<connection-port>'
& $adb devices -l
```

For either USB or wireless, after setting `$device`:

```powershell
& $adb -s $device reverse tcp:3000 tcp:3000
& $adb -s $device reverse tcp:5173 tcp:5173
.\android\gradlew.bat -p android assembleDebug `
  "-Plali.gatewayBaseUrl=http://localhost:3000" `
  "-Plali.webBaseUrl=http://localhost:5173"
& $adb -s $device install -r .\android\app\build\outputs\apk\debug\app-debug.apk
& $adb -s $device shell am start -n 'io.github.gajendrasinghdawar.lali/.MainActivity'
```

Put each continuation backtick at the end of its line. Run the reverse commands again after a reconnect. URL overrides are compiled into the APK. Rebuild and reinstall the APK after you change them. Debug builds permit HTTP. Release builds require HTTPS.

For the standard emulator, omit URL overrides: defaults are `http://10.0.2.2:3000` and `http://10.0.2.2:5173`. See [Android README](android/README.md) for emulator startup/build checks.

On a real phone:

1. Start sign-in. Open the browser approval page. Sign in to the same test account. Approve the device code. Return to Android. Check the conversations. A missing `deviceCode` is a schema problem, not an ADB problem.
2. Open the same conversation in the web client and Android. If the test uses a model, check streaming, matching history, and the absence of duplicate user rows.
3. Upload, send, and download supported files. Verify the saved Android file.
4. Move the app to the background and then to the foreground. Close and reopen it. Check sign-in and history. Disconnect and reconnect the device. Check recovery. Saul does not promise an offline send queue. Sign out and confirm that protected screens are hidden.

Deterministic checks without paid model calls:

```powershell
node --test server/test/attachments.test.ts web/test/chat-view.test.ts
npx tsc --noEmit
npm run build --prefix web
.\android\gradlew.bat -p android testDebugUnitTest lintDebug --console=plain
# Requires attached emulator/device; tests the local Gateway fixture.
.\android\gradlew.bat -p android connectedDebugAndroidTest --console=plain
```

Fixtures do not prove bucket permissions or real Android authorization delivery. See [Android implementation guide](docs/android-client-implementation-guide.md) for the full security and parity checklist.
