# Saul Android client

Native Android client for the Saul backend. Start with the root [quick start](../README.md#android-development); see [release setup](../docs/releases.md) for signed APKs and GitHub Pages distribution. Internal package/property names still use `lali`.

## Toolchain (recorded 2026-09-30)

| Item | Version |
| --- | --- |
| Android CLI (preview) | 1.0.16457483 |
| Project template | `android create empty-activity` (Compose, AGP 9) |
| Gradle wrapper | 9.8.0 |
| AGP | 9.4.1 |
| Kotlin | 2.4.20 |
| Compose BOM | 2026.09.00 |
| Navigation | Navigation 3 1.2.0 (stable; shipped by the official template) |
| Ktor client | 3.6.0 (`OkHttp` engine; cancellation does not disconnect platform HTTP connections on the UI thread) |
| compileSdk / targetSdk | 37 |
| minSdk | 24 (template default; no current dependency needs higher) |
| JDK | Compatible Gradle runtime (CI uses JDK 21); Kotlin/Java toolchain 17 |

The template was generated with older versions. Every version was then updated to the latest stable release that lint reported.

## Gateway URL

`BuildConfig.GATEWAY_BASE_URL`:

- debug: `http://10.0.2.2:3000` (the standard emulator's address for its host's loopback interface).
- release: requires explicit HTTPS `-Plali.gatewayBaseUrl=...` and `-Plali.webBaseUrl=...`, a positive `-Psaul.versionCode=...`, `-Psaul.versionName=...`, and the four signing environment variables documented in the release guide. Invalid/missing configuration fails the release build.
- physical debug device: run `adb reverse tcp:3000 tcp:3000` and build with `-Plali.gatewayBaseUrl=http://localhost:3000`.

Only debug builds may use cleartext HTTP (`src/debug/res/xml/network_security_config.xml`). Release builds allow HTTPS only.

## Build and run

Run from this directory in PowerShell:

```powershell
$env:JAVA_HOME = '<path-to-compatible-Gradle-JDK>'
.\gradlew.bat assembleDebug testDebugUnitTest lintDebug --console=plain
.\gradlew.bat connectedDebugAndroidTest --console=plain
.\gradlew.bat installDebug --console=plain
android run --apks=app\build\outputs\apk\debug\app-debug.apk --device=emulator-5554
```

On Windows, `android emulator` is disabled, so start the AVD with `%LOCALAPPDATA%\Android\Sdk\emulator\emulator.exe -avd <name>`.

On Linux/WSL, use `bash gradlew` instead of `.\gradlew.bat` and install a Linux SDK/JDK. Native Linux can run an accelerated emulator with KVM. For WSL, prefer a Windows-hosted emulator or a wireless ADB phone, with the device connection and backend networking configured explicitly. Do not reuse Windows SDK binaries or build outputs in Linux. Release builds should use `--no-configuration-cache` so signing configuration is not retained in the configuration cache.

## Implemented native slices

- Dark Radix theme, bundled Noto Sans, compact bottom navigation and wide navigation rail.
- Authenticated conversation list, create, rename, and confirmed deletion.
- Foreground SSE snapshots using the Gateway's `conversationId` query; snapshots replace history.
- Multiline composer, optimistic sending, canonical reconciliation, and failed-draft recovery.
- Native Markdown, horizontally scrolling code, collapsible reasoning, and typed tool activity.
- Active durable tasks and confirmed abort; account details, Gateway URL, and session revocation.
- Direct Android Keystore AES/GCM credential encryption in no-backup storage. HTTP/SSE 401 clears the credential and replaces the authenticated navigation root.

Sign-out revokes the server session before deleting the local credential. If revocation fails, the account screen retains the session and offers retry. Normal HTTP requests time out after 30 seconds; chat settlement allows five minutes; SSE stays open until its destination stops.

`GatewayJourneyTest` exercises the Android HTTP/SSE engine, Navigation 3, encrypted credential reload, sending, task abort, failed/retried sign-out, and unauthorized navigation against a local sanitized Gateway fixture. It does not contact a paid model or production service. Unit tests cover CRUD, snapshot mapping, tool identity, send/stream orderings, rollback, and ViewModel transitions.

No offline command queue or automatic command replay is implemented. Chat POSTs include a requestId: a manual retry of the same failed trimmed text, ordered attachment IDs, and whenBusy payload in the same conversation reuses it. Changed payloads and confirmed deliveries get a new ID. This relies on Gateway/Pi deduplication; optimistic transcript reconciliation still checks new durable user IDs and matching text/attachments.

Conversation-keyed chat ViewModels retain drafts, staged uploads, and retry identity when navigating between destinations during the current authenticated composition. Successful settlement clears only the submitted files and an unedited draft; late responses cannot erase a newly edited draft. These are in-memory drafts, not process-death or activity-recreation persistence. Signing out clears them.

The native UI uses the web slate/crimson palette and bundled Noto Sans across headings and body text. Conversation rows expose rename/delete through accessible overflow menus; the account menu contains Sign Out. Chat uses a neutral user bubble, selectable native Markdown, collapsible tool details, and an inset multiline composer. Streaming follows the latest messages only while the reader is near the bottom; Latest messages returns to the live end. Tasks, account, Gateway, and device settings have grouped surfaces, while browser sign-in omits private polling diagnostics and code-bearing URLs. The chat header's connection indicator describes only the active stream, not the availability of other screens. No approval UI, reply, search, or inbox is added by this visual polish.
