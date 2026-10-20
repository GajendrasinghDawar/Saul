# Saul

A personal AI assistant with web and native Android clients. A Node.js backend runs agents through Pi-Durable, with saved conversations, approvals, tasks, and scheduled work.

## Quick start: backend and web

Requirements: Git and Node.js 24 LTS. Run in PowerShell, Linux, or WSL2:

```sh
git clone https://github.com/GajendrasinghDawar/Saul.git
cd Saul
npm ci
npm ci --prefix web
```

For a **new installation**, create local configuration:

```sh
node --input-type=module -e "import { randomBytes } from 'node:crypto'; import { writeFileSync } from 'node:fs'; const keys = ['BETTER_AUTH_SECRET', 'COOKIE_SECRET', 'CSRF_SECRET', 'SAUL_SECRETS_KEY']; writeFileSync('.env', ['NODE_ENV=development', 'BETTER_AUTH_URL=http://localhost:3000', ...keys.map(k => k + '=' + randomBytes(32).toString('hex'))].join('\n') + '\n', { flag: 'wx' });"
```

This refuses to overwrite `.env`. Keep an existing installation's configuration; **never replace its encryption key**. Back up `.env` securely, outside Git.

```sh
npm run dev
```

1. Open **http://localhost:5173**. Create the first account; it becomes administrator.
2. In **Settings**, connect an AI provider and select a default model.
3. Create a chat and send a message. Provider usage may cost money.

Startup creates two local databases and applies checked-in migrations. Text chat needs no Docker, Turso, Resend, or S3. Development ignores remote database credentials. Stop with Ctrl+C; run `npm run dev` to start again. Restart after editing `.env`.

Backend: **http://localhost:3000**. Readiness: **http://localhost:3000/ready**. These development servers must not be exposed publicly.

## Android development

Install a compatible Gradle JDK (21 for CI), the Java 17 toolchain, Android SDK platform 37, and platform-tools. Android Studio can install/manage the SDK and emulator; the [Android CLI](.agents/skills/android-cli/SKILL.md) is another option. Configure your own SDK location through Android Studio or `ANDROID_HOME`; do not reuse another machine's `android/local.properties`.

Keep the backend/web running and start an Android emulator. From the repository root:

```powershell
# Windows
.\android\gradlew.bat -p android installDebug --console=plain
```

```sh
# Linux / WSL with an accessible device
bash android/gradlew -p android installDebug --console=plain
```

Open the app, choose **Sign in with Web**, sign in in the browser, approve access, and return to the app. Standard emulator defaults use `10.0.2.2` to reach the host.

For a **USB-connected phone**, enable USB debugging and accept its authorization prompt, then run:

```sh
adb reverse tcp:3000 tcp:3000
adb reverse tcp:5173 tcp:5173
```

```powershell
.\android\gradlew.bat -p android installDebug "-Plali.gatewayBaseUrl=http://localhost:3000" "-Plali.webBaseUrl=http://localhost:5173"
```

On Linux, replace `.\android\gradlew.bat` with `bash android/gradlew`. If several devices are connected, use `adb -s <serial>` and disconnect unwanted build targets. Repeat reverse forwarding after reconnecting. Debug APKs are for development, not public distribution.

**WSL2:** keep the checkout in `~/projects/Saul`, and install Linux Node, JDK, and Android SDK there. Do not share Windows `node_modules`, SDK binaries, or build outputs. Build everything in that checkout; use a Windows-hosted emulator or wireless ADB phone with connectivity configured separately. `10.0.2.2` points to Windows, not directly to WSL: confirm Windows can reach the WSL backend/web before testing. Native Linux uses a Linux emulator with KVM, or a phone.

## Checks

```sh
npx tsc --noEmit
node --test "server/test/*.test.ts" "web/test/*.test.ts"
npm run db:check
npm run build --prefix web
```

```powershell
.\android\gradlew.bat -p android assembleDebug testDebugUnitTest lintDebug --console=plain
```

GitHub Actions runs these checks and a container startup check on pushes to `main` and pull requests. CI does not use production secrets or paid model calls. Device/instrumentation tests remain a separate manual check.

## Publish and deploy

After the [one-time release setup](docs/releases.md):

1. **Actions → Release → Run workflow** on `main`: enter the version and a higher Android version code. Checks run before publishing a signed `saul.apk`, checksum, and backend container reference to GitHub Releases.
2. **Actions → Deploy backend**: paste the immutable image reference from the release's `backend-image.txt`. Deployment uses verified SSH and leaves production `.env` on the VPS.
3. Share the **GitHub Pages download page**, which links to the latest release APK. Pages hosts only this static page, not Saul's backend. With default Pages settings its URL is `https://gajendrasinghdawar.github.io/Saul/` **after a successful Pages deployment**.

Workflows are included; publishing still requires GitHub configuration, a release-signing key, and real HTTPS server URLs. Release APKs connect to the backend selected at build time. Downloading does not create an account; the server administrator must grant access. Private repository releases require GitHub access and are not an anonymous sharing mechanism.

Production currently targets one VPS process, two separate remote libSQL databases, and Caddy HTTPS. [Release/deployment instructions](docs/releases.md) cover configuration, upgrades, and recovery. Native push notifications and offline message queuing are not implemented. Android's server-settings panel still needs migration from the removed `/api/secrets` API; use web Settings for AI configuration.

## More detail

- [Local configuration, databases, attachments, and phone testing](docs/local-development.md)
- [Android client and toolchain](android/README.md)
- [AI settings](docs/server-settings.md)
- [Durable execution and restart recovery](docs/durable-reliability.md)
- [Attachment storage and backups](docs/attachments.md)

Code lives in `server/`, `web/`, and `android/`. App migrations live in `server/drizzle/`. Local databases live in untracked `data/`; never commit databases, credentials, or signing keys.
