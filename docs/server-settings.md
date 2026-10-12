# Server-managed service settings

Only administrators can use `/api/secrets`. The five supported settings are
`AZURE_OPENAI_API_KEY`, `RESEND_API_KEY`, `MY_EMAIL_ADDRESS`,
`AZURE_OPENAI_BASE_URL`, and `AZURE_OPENAI_MODEL`. All stored overrides use
AES-256-GCM with a random nonce and authentication bound to the setting name.
Decrypted values stay in server memory; provider keys are not copied to
`process.env`. This does not protect against a compromised running server.

## Bootstrap

Supply `SAUL_SECRETS_KEY` externally as exactly 64 hexadecimal characters (32
random bytes). Generate once with `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`.
Keep it in a deployment secret manager, not in this settings UI or the database.
Back it up separately from the database. Losing it makes stored overrides
unrecoverable. There is no automatic key rotation. All override writes require
the key, including development writes and non-secret settings.

Keep database location/access, server port, deployment mode, authentication URL,
`BETTER_AUTH_SECRET`, `COOKIE_SECRET`, and `CSRF_SECRET` outside the UI.
Only the five supported service settings are loaded from the database.
Bootstrap values must come from external configuration, not database rows.
No users are promoted by this settings feature.
The first account created on an empty installation becomes the administrator.
Public registration closes after that; only an authenticated administrator can
register additional accounts, which receive the normal user role. Signup
requests are serialized in the single backend process. The role field is
server-controlled; clients cannot choose it at signup or change it through
profile updates. Existing accounts are not automatically promoted.
The existing bootstrap file loading behavior is unchanged; do not configure
conflicting bootstrap values in multiple places.

Service environment variables remain optional fallbacks. After configuring an
override, remove its external fallback only when that is intentional: deleting
an override reveals the fallback, rather than disabling the service.

## API

* `GET /api/secrets`: array of `{name,kind,value,isSet,applyMode,pendingRestart}`.
  Always lists all five definitions. Secret values are always `null`.
  `isSet` reflects the effective override or environment fallback. Responses are
  `Cache-Control: no-store`.
* `POST /api/secrets`: JSON `{name,value}`. Kind is determined by the server.
  Empty, masked, excessively long and control-character values are rejected.
  Email must be an email address; model must be a deployment identifier; base
  URL must be HTTPS without credentials, query or fragment.
* `DELETE /api/secrets/:name`: JSON `{password}`. The current user's password is
  verified with Better Auth's public `api.verifyPassword` before deletion.
  Incorrect password returns 403; missing password returns 400. Passwordless
  accounts cannot delete overrides through this API.
* Successful mutations return `{success:true,applyMode,pendingRestart}`.
  Errors are `{error:string}`. Unauthenticated requests return 401; signed-in
  non-administrators return 403. There is no bulk mutation or alternate delete
  endpoint. Fetch GET again after mutations to inspect effective fallback state.

Bearer requests authenticate with cookies removed; an invalid bearer token
cannot fall back to a valid cookie. Cookie-authenticated mutations require the
existing `/csrf-token` cookie and `x-csrf-token` request header. Settings requests
are limited to 20 per minute per IP, including password deletion attempts.

Keys and mail recipient apply to new requests immediately. Already-running
requests can finish with previous values. Model and base URL changes need a
process restart: `pendingRestart` compares the effective value to the snapshot
actually used by the running model configuration, including after deletion.
The default model remains `gpt-6-luna`. No restart endpoint is provided.
This cache is single-process: restart other server instances after mutations.

## Development setup

Start with an empty settings table, supply the bootstrap values, and enter
service settings through the UI. Old development settings are not supported or
converted. If you have old plaintext service rows, reset the development
settings table and enter the values again; there is no data-preservation cutover.
Resetting settings does not require deleting chats or accounts. No reset runs
automatically.

Supported rows must use the current encrypted format. A missing or wrong key,
invalid format, or damaged ciphertext stops startup instead of silently using
an external fallback. This protects current data; it is not legacy support.

## Local verification and release limits

The built web client was checked against the real settings routes and Better
Auth with a disposable account and separate databases. The checks covered
unauthenticated access, invalid bearer with a valid cookie, missing browser
CSRF, protected replacement, draft cancellation, password-verified deletion,
external fallback after deletion, and pending restart status. The stored model
override was also confirmed to contain an encrypted envelope, not plaintext.

Backend type checking, web build and lint, Android build and lint, and all 24
existing Android unit tests passed. Android settings visuals were inspected in
the production app shell using sanitized state fixtures. These fixtures do not
prove Android-to-server settings delivery. No real provider or email request,
production deployment, or production data migration was performed.

The existing SQL migrations omit the declared `user.role` column and
`deviceCode` table. Local browser verification repaired only the disposable
fixture's role column. A fresh installation is not release-ready until those
migrations and administrator provisioning are verified.
