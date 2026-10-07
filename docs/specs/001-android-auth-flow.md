## Problem Statement

The native Android client needs a secure way to authenticate users against the Saul backend. Native apps cannot safely pretend to be web browsers or share browser cookie jars. Furthermore, duplicating the entire authentication UI (Sign In, Sign Up, Forgot Password, Rate Limiting) into native Kotlin screens represents a massive maintenance burden for a solo developer. 

## Solution

We will implement a "Device-Link" authentication flow. The Android app will delegate the sign-in process to a Chrome Custom Tab pointing to the web app's existing login page. Upon a successful login, the web app will intercept the success state and hand the session token back to the Android app via a custom deep link. The Android app will then use this token as a Bearer token for all future API calls.

## User Stories

1. As an Android user, I want to tap "Sign In" and see a secure browser tab open, so that I can use my existing password manager to log in securely.
2. As an Android user, I want to be seamlessly redirected back to the native app after logging in, so that I can start chatting without manual copy-pasting.
3. As an Android user, I want my session to remain active between app launches, so that I don't have to log in every time I open the app.
4. As an Android user, I want to tap "Sign Out" to clear my local credentials and return to the login screen, so that I can protect my account on shared devices.
5. As a developer, I want to build the Auth UI only once on the web, so that I don't have to maintain separate Native Kotlin screens for password resets, email verification, and sign-ups.
6. As a developer, I want to use standard `Authorization: Bearer <token>` headers from the Android app, so that the Backend's Better Auth middleware can validate requests uniformly without native-specific hacks.

## Implementation Decisions

- **Auth Handoff URL Parameter:** The Android app will launch the Chrome Custom Tab to `<BASE_URL>/login?client=android`.
- **Web App Redirection:** The Web UI (Vite) will be updated to check for the `client=android` search parameter. If present, upon successful authentication, instead of routing to the web dashboard, it will extract the session token and redirect the browser to `saul://auth?token=<TOKEN>`.
- **Deep Link Scheme:** The Android app will use `saul://auth` as its custom scheme for local development. (Note: This will be upgraded to verified Android App Links (`https://saul.app/auth`) before Play Store deployment to prevent intent hijacking).
- **Token Storage:** The Android app will intercept the `saul://` intent in its `SignInViewModel` or `MainActivity`, extract the token, and store it securely (e.g., using DataStore backed by EncryptedSharedPreferences/Keystore).
- **Network API:** The Android `GatewayClient` will be configured to attach `Authorization: Bearer <token>` to all Ktor HTTP and SSE requests.
- **Backend Auth:** The Saul backend already uses Better Auth, which natively supports reading session tokens from Bearer headers. No major backend configuration changes are required.

## Testing Decisions

Tests should verify external behavior rather than implementation details:

- **Web Frontend (Vite):** Test the Login component's redirect logic. Given a mock URL with `?client=android` and a mocked successful Better Auth `signIn` response, assert that `window.location.href` (or the router equivalent) is mutated to the correct `saul://auth?token=...` string.
- **Android Network Client:** Test `GatewayClient` using a Ktor `MockEngine`. Given a stored token, assert that the outgoing HTTP request contains the correct `Authorization: Bearer` header.
- **Android UI/ViewModel:** Test `SignInViewModel`. Given a simulated incoming deep link intent containing a token, assert that the ViewModel transitions to an authenticated state and saves the token to the local repository.
- **Prior Art:** We will follow the existing Ktor `MockEngine` testing patterns established in the Android scaffolding (`GatewayClientTest.kt`).

## Out of Scope

- Setting up production Android App Links (`.well-known/assetlinks.json`) domain verification. This is deferred until the app has a live public domain and is preparing for Play Store release.
- Implementing Social Logins (Google/GitHub). The backend currently relies exclusively on Email/Password authentication.
- Implementing token refresh rotation. Better Auth manages session expiration; the initial release will require a re-login if the long-lived session expires.

## Further Notes

- The Android emulator accesses the host machine's localhost via `10.0.2.2`. Therefore, the Android app's base API URL must be configured to `http://10.0.2.2:3000`, and the Custom Tab should launch `http://10.0.2.2:5173/login?client=android`.
