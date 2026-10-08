# Android Authentication: Troubleshooting, Edge Cases, and Architecture

This document records the architectural decisions, root cause analyses, and edge cases encountered and resolved while implementing the OAuth 2.0 Device Authorization Grant (RFC 8628) for the native Android client with Better Auth.

---

## 1. Architecture Overview

The native Android client uses browser-delegated authentication through the OAuth 2.0 Device Authorization Grant, eliminating the need to embed credentials, webviews, or OAuth callbacks inside the mobile app:

```text
+-----------------------+                    +-------------------------+
|     Android Client    |                    |     Express Gateway     |
| (Ktor + Navigation 3) |                    |  (Better Auth + Bearer) |
+-----------------------+                    +-------------------------+
            |                                             |
            | 1. POST /api/auth/device/code               |
            |-------------------------------------------->|
            |    (client_id: "android-client")            |
            |                                             |
            | 2. Returns user_code, device_code, interval |
            |<--------------------------------------------|
            |                                             |
            | 3. Launches Chrome Custom Tab:              |
            |    http://10.0.2.2:5173/device?user_code=.. |
            |    [User logs in and clicks "Approve"]      |
            |                                             |
            | 4. POST /api/auth/device/token (polling)    |
            |    (grant_type, device_code, client_id)     |
            |-------------------------------------------->|
            |                                             |
            | 5. If pending: HTTP 400 authorization_pend  |
            |    If approved: HTTP 200 { access_token }   |
            |<--------------------------------------------|
            |                                             |
            | 6. Persists token in Android Keystore       |
            |    Transitions UI to HomeScreen             |
            v                                             v
```

---

## 2. Issues Encountered and Root Causes

### Issue 1: Vite Dev Server IPv6 Loopback Hang

- **Symptom**: Custom Tab opened `http://10.0.2.2:5173/device?user_code=...`, but the browser remained perpetually blank and loading stalled indefinitely without network errors.
- **Root Cause**: On Windows with Node.js 22, Vite defaulted to binding to IPv6 localhost (`[::1]:5173`). The Android emulator maps `10.0.2.2` exclusively to host IPv4 loopback (`127.0.0.1`). Because no socket was listening on IPv4 `127.0.0.1:5173`, connection attempts timed out.
- **Fix**: Updated `web/vite.config.ts` to explicitly bind to all IPv4 interfaces:
  ```ts
  server: {
    host: '0.0.0.0',
    port: 5173,
  }
  ```

---

### Issue 2: KotlinX Serialization Omission of Default Values

- **Symptom**: During device token polling, the backend responded with HTTP 400:
  ```json
  {"message":"[body.grant_type] Invalid input: expected \"urn:ietf:params:oauth:grant-type:device_code\"","code":"VALIDATION_ERROR"}
  ```
- **Root Cause**: The data class `DeviceTokenRequest` declared default parameter values:
  ```kotlin
  @Serializable
  data class DeviceTokenRequest(
      @SerialName("grant_type") val grantType: String = "urn:ietf:params:oauth:grant-type:device_code",
      ...
  )
  ```
  In KotlinX Serialization, fields whose values match their default parameter values are omitted from serialized JSON unless `encodeDefaults = true` is configured on the `Json` instance. Ktor's `ContentNegotiation` was using the default `encodeDefaults = false`, causing `{"device_code":"...","client_id":"..."}` to be transmitted without `grant_type`.
- **Fix**:
  1. Configured `encodeDefaults = true` in Ktor client setup (`AppContainer.kt`):
     ```kotlin
     install(ContentNegotiation) {
       json(Json {
         ignoreUnknownKeys = true
         explicitNulls = false
         encodeDefaults = true
       })
     }
     ```
  2. Removed default value assignments from `DeviceTokenRequest` and explicitly populated `grantType` in every call to prevent accidental serialization omission.

---

### Issue 3: In-Memory Rate Limiting in Development

- **Symptom**: Polling the token endpoint produced HTTP 429 "Too many requests" after a few attempts.
- **Root Cause**: Better Auth includes built-in rate limiting enabled by default. In development, multiple emulator requests originate from localhost or unresolved client addresses, saturating the rate limiter bucket rapidly.
- **Fix**: Disabled Better Auth rate limiting in development mode in `src/auth/auth.ts`:
  ```ts
  rateLimit: {
    enabled: getSecret('NODE_ENV') === 'production',
  }
  ```

---

### Issue 4: Better Auth Trusted Origins and CSRF

- **Symptom**: Requests from the emulator or custom tab to `/api/auth/device` endpoints failed CSRF/origin validation.
- **Root Cause**: Better Auth validates `Origin` headers against `trustedOrigins`. Requests from `10.0.2.2` were not recognized as valid origins.
- **Fix**: Added both port 5173 and port 3000 emulator URLs to `trustedOrigins` in `src/auth/auth.ts`:
  ```ts
  trustedOrigins: [
    'http://localhost:5173',
    'http://localhost:3000',
    'http://10.0.2.2:5173',
    'http://10.0.2.2:3000',
  ]
  ```

---

### Issue 5: Windows Java Environment Configuration

- **Symptom**: Running Gradle with default environment variables failed with:
  ```text
  ERROR: JAVA_HOME is set to an invalid directory: C:\Program Files\Android\Android Studio\jbr
  ```
- **Root Cause**: Android Studio installation directory differed from the default path, and no system-wide JDK 17+ was on `PATH`.
- **Fix**: Set `JAVA_HOME` explicitly to the JetBrains Runtime:
  ```powershell
  $env:JAVA_HOME = "C:\Users\dawar\.jdks\jbr-17.0.14"
  ```

---

## 3. Edge Cases and Mitigations

| Edge Case | Description | Mitigation |
|:---|:---|:---|
| **`authorization_pending`** | User has opened the browser but not yet approved the request. | Continue polling with interval delay; do not treat as fatal error. Show live polling count in UI. |
| **`slow_down`** | Client is polling faster than allowed interval. | Increment polling delay by 5 seconds per RFC 8628 specification. |
| **`expired_token`** | The device code lifetime (`expires_in`) elapsed before user confirmation. | Stop polling, notify user with error message, and return to initial "Sign in with Web" action. |
| **`access_denied`** | User tapped "Deny" on the authorization screen. | Stop polling immediately, display cancellation notice, and reset state. |
| **Network Failure during Poll** | Wi-Fi or cellular transient drop during poll interval. | Catch exception, record retry in progress trace, and continue until `expiresIn` budget ends. |
| **Process Death / Restart** | App process killed while user is in browser or afterwards. | Token is stored in `EncryptedSharedPreferences` backed by Android Keystore. On cold launch, `sessionToken` is restored immediately without re-prompting. |
| **User Abort / Back Navigation** | User dismisses Custom Tab or cancels before approving. | Polling loop honors coroutine cancellation; coroutine scope lifecycle tied to screen ViewModel stops background requests cleanly. |

---

## 4. UI Observability (Bret Victor Principle)

To avoid "black box" authentication failures, both client and web verification screens expose live visible status:

1. **Android Client (`SignInScreen.kt`)**:
   - Verification code badge displayed directly on screen.
   - Live polling status and attempt count (`Awaiting approval in browser (attempt #3)`).
   - Target authorization URL displayed for manual opening if Custom Tab fails.
   - Direct Gateway connectivity check button with real-time status indication.
2. **Web Verification Page (`web/src/routes/device.tsx`)**:
   - Live Activity Trace showing received code parsing, backend verification, and authorization dispatch.
   - Automatic redirect to `/login` if unauthenticated, preserving `user_code` parameter via `?redirect=`.
   - Clear visual confirmation of approval state with checkmarks.
