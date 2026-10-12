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
Existing legacy bootstrap rows still take precedence over environment values so
authentication signing keys are not silently changed. Move those keys outside
the database only in an explicitly coordinated maintenance operation, preserving
their exact existing values. No users are promoted by this settings feature.
The role field is server-controlled; sign-up and profile updates cannot grant
admin privileges. Fresh installations need an operator-provisioned administrator.
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

## Explicit legacy cutover (operator-controlled; not run automatically)

Startup refuses plaintext rows for the five service settings. Encrypted rows
with a missing/wrong key or authentication failure also stop startup; neither
case silently falls back to environment values. Existing bootstrap plaintext
rows are preserved, not converted.

1. Stop every server instance and disable replica synchronization for the
   maintenance operation. Back up the database, WAL state and current bootstrap
   values securely. Test the procedure on an isolated copy first.
2. Securely record the exact five service values, if present, without writing
   them into logs or shell history. Keep bootstrap rows unchanged.
3. Provision `SAUL_SECRETS_KEY`. Remove only legacy plaintext service rows in
   an explicit database transaction using your database administration tool:

   ```sql
   BEGIN;
   DELETE FROM secrets
   WHERE name IN ('AZURE_OPENAI_API_KEY', 'RESEND_API_KEY', 'MY_EMAIL_ADDRESS',
                  'AZURE_OPENAI_BASE_URL', 'AZURE_OPENAI_MODEL')
     AND value NOT LIKE 'saul:v1:%';
   COMMIT;
   ```

4. Start the server with the recorded service values temporarily supplied via
   a secure external environment, keeping existing signing keys identical.
   Sign in as an existing administrator and save each value through the UI/API.
   This writes encrypted overrides; verify configured status without exposing
   keys. Restart after model/base URL changes.
5. Remove temporary external service values and restart. Verify email and model
   operation. Roll back to the secure backup if verification fails; do not
   rotate signing keys or promote accounts as part of this cutover.
6. Retire plaintext backups under the deployment's retention policy. Database
   free pages, WAL files and replicas can retain old plaintext: logical deletion
   is not secure erasure. Coordinate their cleanup separately with the operator.

This procedure requires deliberate operator database changes. No schema change,
automatic plaintext conversion, or production database mutation is performed by
the implementation.

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
migrations and administrator provisioning are verified. Existing plaintext
service settings also require the explicit cutover above before this version
can start. Do not deploy this change directly over an unreviewed database.
