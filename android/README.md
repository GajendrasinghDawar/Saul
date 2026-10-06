# Lali Android client

Native Android client for the Lali Gateway. See `docs/android-client-implementation-guide.md`.

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
| Ktor client | 3.6.0 (`Android` engine) |
| compileSdk / targetSdk | 37 |
| minSdk | 24 (template default; no current dependency needs higher) |
| JDK | Android Studio JBR 25 runs Gradle; Kotlin/Java toolchain 17 |

The template was generated with older versions. Every version was then updated to the latest stable release that lint reported.

## Gateway URL

`BuildConfig.GATEWAY_BASE_URL`:

- debug: `http://10.0.2.2:3000` (the emulator's address for the host's loopback interface; the Gateway binds to `127.0.0.1`).
- release: empty unless you pass `-Plali.gatewayBaseUrl=https://...`.
- physical debug device: run `adb reverse tcp:3000 tcp:3000` and build with `-Plali.gatewayBaseUrl=http://localhost:3000`.

Only debug builds may use cleartext HTTP, and only to `10.0.2.2`, `localhost`, and `127.0.0.1` (`src/debug/res/xml/network_security_config.xml`). Release builds allow HTTPS only.

## Build and run

```text
set JAVA_HOME=C:\Program Files\Android\Android Studio1\jbr
gradlew assembleDebug testDebugUnitTest lintDebug
gradlew connectedDebugAndroidTest
android run --apks=app\build\outputs\apk\debug\app-debug.apk --device=emulator-5554
```

On Windows, `android emulator` is disabled, so start the AVD with `%LOCALAPPDATA%\Android\Sdk\emulator\emulator.exe -avd <name>`.
