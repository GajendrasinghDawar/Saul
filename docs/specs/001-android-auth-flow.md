# Native Android authentication

Status: completed for slice 1. Better Auth device authorization and bearer plugins, the `deviceCode` schema model, the web verification page, and Android request/polling code are implemented and verified end-to-end on emulator. Detailed troubleshooting, root causes, and edge cases are documented in [`docs/android-auth-troubleshooting-and-edge-cases.md`](../android-auth-troubleshooting-and-edge-cases.md).

The authoritative implementation sequence is in [`docs/android-client-implementation-guide.md`](../android-client-implementation-guide.md#authentication-design).

## Problem

The Android client needs a durable identity for authenticated HTTP, mutation, and SSE requests. The selected Better Auth device flow now exists, but it still needs database migration, client validation, browser return handling, revocation, and automated end-to-end proof.

## Decision

Use browser-owned sign-in followed by a one-time device authorization exchange.

```text
Android requests a short-lived device challenge
-> Android opens the Gateway verification page in a Custom Tab
-> user signs in through the existing Better Auth web flow
-> authenticated user approves the device challenge
-> Android polls at the server-provided interval
-> Gateway returns a revocable Better Auth session token once
-> Android encrypts the credential with an Android Keystore key
-> Ktor uses it for HTTP and SSE Authorization headers
```

The selected first-party implementation is Better Auth `deviceAuthorization()` plus `bearer()`. Android uses client ID `android-client`, polls `/api/auth/device/token`, and receives a Better Auth session token. Standardize and validate that client ID before release.

## Security requirements

- Browser URLs contain only the human-readable, short-lived user code.
- The flow uses polling and has no authentication callback or credential-bearing deep link.
- Every challenge is random, short-lived, single-use, and bound to the initiating client ID.
- Tokens never appear in URLs, logs, analytics, screenshots, notifications, or clipboard content.
- Android stores bearer material encrypted with a non-exportable Android Keystore key.
- The Gateway stores only the server-side representation needed to validate or revoke a credential.
- Users can list and revoke Android device sessions.
- Sign-out removes the credential and all user-scoped local cache.
- Authentication failures close active SSE streams and return to the signed-out root flow.
- Gateway ownership and role checks remain authoritative for every API operation.

## Remaining Gateway work

1. Generate, review, and apply the `deviceCode` Drizzle migration.
2. Configure `validateClient` to accept only `android-client`.
3. Make unauthenticated verification return through login to `/device?user_code=...`.
4. Remove the obsolete token-in-custom-URL branch from the login page.
5. Verify `createAuthGuard()` resolves the native bearer identity.
6. Define CSRF behavior for bearer-authenticated mutations separately from browser-cookie requests.
7. Add device-session revocation and expiry behavior.
8. Verify authenticated HTTP, mutation, and SSE requests with automated tests.
9. Remove request, token, code, and transcript debug logging.
10. Return stable `401` and `403` error bodies.

## Remaining Android work

1. Replace the alpha/deprecated `EncryptedSharedPreferences` prototype with direct Android Keystore-backed encryption.
2. Keep sign-in coordination in `AuthRepository`; ViewModels must not receive `Activity` or `Context`.
3. Resolve relative verification URLs against the configured Gateway URL.
4. Handle `authorization_pending`, `slow_down`, denial, expiry, cancellation, and transient network failures explicitly.
5. Stop polling when the sign-in flow is cancelled or its owner is cleared.
6. Validate the resulting token with `/api/auth/get-session` before entering the authenticated graph.
7. Attach the bearer credential to normal and SSE requests.
8. Revoke the remote session before clearing the local credential and cached user data.
9. Add repository, ViewModel, process-restart, and Compose tests.

## Acceptance tests

- successful browser authorization and return;
- challenge expiry, replay, malformed input, and cancellation;
- no credential-bearing callback or deep link is registered;
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
