# Saul

Saul is a personal AI assistant for conversations, tasks, reminders, and context. You can use it on the web and on Android. Saul helps you turn plans into actions. It can send Android notifications and scheduled check-ins.

## What it provides

- Multi-device access through the web client and Android app.
- Saved conversations and task workflows.
- Scheduled reminders and briefings.
- Optional file attachments with private S3-compatible storage.
- Local development with SQLite and Pi-Durable execution history.

This repository is an active personal project. Some features need external services. The instructions in this file describe local development. They are not production deployment instructions.

## Documentation

- [Local setup](#local-setup-windows-powershell)
- [Manual web checks](#manual-web-checks)
- [S3-compatible attachments](#s3-compatible-attachments)
- [Android local testing](#android-real-local-testing)
- [Android implementation guide](docs/android-client-implementation-guide.md)
- [Server settings](docs/server-settings.md)
- [Attachment storage and backups](docs/attachments.md)

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

Create or edit the untracked root `.env` file. Never commit real secrets. The backend loads `.env` with `override: true`. This overrides PowerShell environment values. Do not define the same value in both places.

```dotenv
NODE_ENV=development
BETTER_AUTH_URL=http://localhost:3000
BETTER_AUTH_SECRET=<independent-random-auth-secret>
COOKIE_SECRET=<independent-random-cookie-secret>
CSRF_SECRET=<independent-random-csrf-secret>
SAUL_SECRETS_KEY=<64-hex-character-key-generated-once>
TURSO_DATABASE_URL=file:./data/local-turso.db
```

Set the signing secrets even though bootstrap validation only warns when they are missing. The default auth URL is `http://localhost:3000`. The default database URL is `file:./data/local-turso.db`. The default `PORT` is `3000`. Generate each secret with:

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Generate `SAUL_SECRETS_KEY` **once per installation** with that command. It must contain exactly 64 hexadecimal characters. Keep it outside the database and the Settings UI. Store a separate backup in a secure password manager. Reuse the same key after a restart or restore. If you lose or replace the key, Saul cannot read saved settings and may not start. An empty settings table can start without the key, but every Settings write needs it. Do not generate a new key for an existing installation.

Optional service configuration:

- Chat needs `AZURE_OPENAI_API_KEY`, `AZURE_OPENAI_BASE_URL`, and `AZURE_OPENAI_MODEL`. Use your provider's HTTPS API base URL and your real deployment or model name. These values are not needed to open the UI. The default model is `gpt-6-luna`. Do not assume that your account provides this model.
- Set `AZURE_OPENAI_INPUT=text,image` only when the deployment supports images. Unknown deployment names use text-only input. Restart the backend after you change the model, base URL, or input setting.
- `RESEND_API_KEY` enables email, including password reset. `MY_EMAIL_ADDRESS` sets the recipient. Basic email/password sign-in does not need a Resend key.
- S3 settings enable attachments. They are not needed for text chat. See [S3-compatible attachments](#s3-compatible-attachments).
- Use `TURSO_AUTH_TOKEN` and `TURSO_SYNC_URL` only for an intentional remote database or replica. Omit both for local testing. A sync URL starts remote sync at startup.

An administrator can enter service values in Settings instead of `.env`. Encrypted database overrides take priority over environment values. Delete an override to use its environment value again. Keep bootstrap and database credentials outside Settings. See [server settings](docs/server-settings.md).

### Database setup

The account database defaults to `data\local-turso.db`. Pi history and checkpoints use `data\lali-durable.sqlite`. This database is independent of the account database URL. Root-level databases with similar names are not these databases. Pi creates its storage at startup. The account schema must exist before startup loads Settings.

For a **new, empty local database only**, confirm that `.env` points to that database. Then run:

```powershell
New-Item -ItemType Directory -Force .\data | Out-Null
npm run db:push
```

`db:push` uses `server/db/schema.ts`. The checked-in SQL migrations do not include `user.role` or `deviceCode`. Do not use those migrations alone for current authentication or Android support. The repository has no root migration runner. `db:seed` inserts example todos. It does not create the schema or an administrator. It is optional.

For an **existing installation**, stop the backend before schema work. Back up both databases, configuration, and the separate encryption key. Include journal or WAL files when applicable. Do not delete databases. Do not reset Settings. Do not run `db:seed`. Do not accept destructive `db:push` prompts without review. Compare the account schema with `server/db/schema.ts`. Test a data-preserving migration on a backup first. The repository has no verified migration or admin-promotion command for existing installations. Existing users are not promoted automatically. See [server settings release limits](docs/server-settings.md).

### Start development

```powershell
npm run dev
```

This starts the backend (`tsx watch server/server.ts`) and Vite together. You can also run `npm run dev:backend` and `npm run dev:web` in separate terminals. Press Ctrl+C to stop them. After a Settings change that needs a restart, stop and start the backend. Saving Settings does not restart the backend.

- Web: `http://localhost:5173`. If this port is busy, use the URL that Vite prints.
- Health check: `http://localhost:3000/health`.
- Vite proxies `/api`, `/csrf-token`, and `/health` to `http://localhost:3000`. If you change the backend port, update the proxy too.

Vite binds to all interfaces. Use a trusted local network. Do not expose this development setup to the public internet.

## Manual web checks

1. Open the web client. On an empty installation, create the first account. Saul makes this account an administrator. Public registration then closes. Only an authenticated administrator can create more users. On an existing installation, use an existing account.
2. Sign out and sign in. Check the conversation list. Create, rename, and select a test conversation. Open Tasks. These checks do not need a model call.
3. As an administrator, open Settings. Save a test service value. Refresh the page. Check masked keys and restart indicators. A non-administrator must not access secrets. Do not replace working credentials only for testing.
4. Send a short message only when provider usage is acceptable. Use a configured Azure deployment. Check that Saul creates one user row, streams the response, and keeps the history after reload. Check the transcript before you retry an unclear send error.

## S3-compatible attachments

Create a **private** bucket. Create dedicated server credentials with permission to put and get objects under `saul/attachments/*`. Saul does not create buckets. Do not make files public. Do not put server credentials in clients. Enter these settings in administrator Settings, or use environment values. Then **restart the backend**:

| Setting | AWS S3 | Cloudflare R2 | Appwrite S3-compatible storage |
| --- | --- | --- | --- |
| `S3_ENDPOINT` | `https://s3.<aws-region>.amazonaws.com` | `https://<account-id>.r2.cloudflarestorage.com` | `https://<region>.cloud.appwrite.io/v1/s3`, using your project's region |
| `S3_REGION` | Actual bucket region, e.g. `us-east-1` | `auto` | Project region, e.g. `nyc`, or `auto` |
| `S3_BUCKET` | Actual bucket name, not ARN | Actual bucket name, not account ID | Actual bucket **ID**, not display name or project ID |
| `S3_ACCESS_KEY_ID` | Dedicated IAM access key ID | R2 S3 access key ID | Appwrite project ID |
| `S3_SECRET_ACCESS_KEY` | Matching IAM secret | Matching R2 secret | Appwrite API key secret from that same project |

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

1. Save the settings and restart the backend.
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
