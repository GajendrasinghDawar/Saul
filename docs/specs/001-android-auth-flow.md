# Native Android authentication

Status: planned; implementation has not started.

The authoritative implementation sequence is in [`docs/android-client-implementation-guide.md`](../android-client-implementation-guide.md#authentication-design).

## Problem

The Android client needs a durable identity for authenticated HTTP and SSE requests. The current Gateway is proven only with Better Auth browser session cookies. The Android scaffold does not yet have an approved native authentication contract.

## Decision

Use browser-owned sign-in followed by a one-time device authorization exchange.

```text
Android requests a short-lived device challenge
-> Android opens the Gateway verification page in a Custom Tab
-> user signs in through the existing Better Auth web flow
-> authenticated user approves the device challenge
-> Android polls at the server-provided interval
-> Gateway returns a scoped, revocable credential once
-> Android encrypts the credential with an Android Keystore key
-> Ktor uses it for HTTP and SSE Authorization headers
```

Evaluate Better Auth’s installed `deviceAuthorization` and `bearer` plugins first. If they do not meet the requirements, implement the same protocol with project-owned one-time codes. Record the final plugin/API decision in this specification before coding.

## Security requirements

- The callback and browser URLs contain only an opaque, short-lived challenge or authorization code.
- Release builds use verified HTTPS Android App Links.
- A debug-only custom scheme may be used for local development.
- Every challenge is random, short-lived, single-use, and bound to the initiating client/state.
- Tokens never appear in URLs, logs, analytics, screenshots, notifications, or clipboard content.
- Android stores bearer material encrypted with a non-exportable Android Keystore key.
- The Gateway stores only the server-side representation needed to validate or revoke a credential.
- Users can list and revoke Android device sessions.
- Sign-out removes the credential and all user-scoped local cache.
- Authentication failures close active SSE streams and return to the signed-out root flow.
- Gateway ownership and role checks remain authoritative for every API operation.

## Gateway work

1. Configure and test the selected Better Auth native plugins or equivalent device-code endpoints.
2. Make `createAuthGuard()` resolve the native bearer identity.
3. Define CSRF behavior for bearer-authenticated mutations separately from browser-cookie requests.
4. Add device-session revocation and expiry.
5. Verify authenticated HTTP and SSE requests.
6. Remove request, token, and transcript debug logging.
7. Return stable `401` and `403` error bodies.

## Android work

1. Replace plaintext `SharedPreferences` token storage with a Keystore-backed credential store.
2. Move sign-in coordination into `AuthRepository`; ViewModels must not receive `Activity` or `Context`.
3. Configure the verification URL through `BuildConfig` rather than hard-coding emulator addresses.
4. Open the verification page in a Custom Tab.
5. Poll or exchange the one-time challenge through Ktor.
6. Drive the Navigation 3 root flow from authenticated state.
7. Attach the bearer credential to normal and SSE requests.
8. Clear credential and cached user data atomically on sign-out.

## Acceptance tests

- successful browser authorization and return;
- challenge expiry, replay, malformed input, and cancellation;
- callback interception attempt from an unverified source;
- process restart remains signed in;
- revoked or expired credential returns to sign-in;
- authenticated conversation list and SSE stream use the same identity;
- sign-out clears encrypted credential and user cache;
- test logs and captured artifacts contain no token.

## Out of scope for the first slice

- social login;
- credential transfer between devices;
- biometric gating of every request;
- background push notifications;
- chat, conversations, and offline cache UI.
