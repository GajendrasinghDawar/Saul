# Administrator AI configuration

Settings manages Pi AI providers, protected credentials, custom endpoints and
the default model. Saul passes the same Pi AI `Models` collection to Pi Durable;
there is no separate provider protocol adapter or coding-agent configuration
loader. The installed Pi AI catalog supplies built-in chat models and their
capabilities, including image input and reasoning.

## Setup

1. Supply the root `.env` bootstrap values described in [README](../README.md).
   Generate `SAUL_SECRETS_KEY` once: it must contain 64 hexadecimal characters.
   Back it up separately from the databases and reuse it after moving servers.
2. Run `npm run dev`. Development uses isolated local app and Pi databases,
   never the configured cloud databases. Startup applies checked-in migrations.
3. Sign in as an administrator and open Settings. On a fresh installation, the
   first registered account becomes the administrator.
4. Choose a provider and complete one of its native login methods. API keys,
   account authorization links, device codes and manual callbacks are presented
   only when the installed Pi provider offers them. Amazon Bedrock and other
   ambient-only providers use their native server credential chain.
5. Select a default model, then create a new chat. Credentials being configured
   does not prove model permissions or a working network connection.

For a custom compatible endpoint, choose **Custom connection**, enter a unique
connection ID, base URL and Pi API family, then define the actual models it
serves. Supported families are OpenAI Completions, OpenAI Responses, Anthropic
Messages, Google Generative AI and Azure OpenAI Responses. Use HTTPS, or HTTP
loopback for local model servers; URLs cannot contain credentials, query strings
or fragments. API keys are entered separately through the native login prompt.
Keyless connections use a placeholder API key because the underlying SDK still
requires one; the endpoint itself must not require authentication.

Use the model's real input capabilities and token limits, not guessed values.
The **Native Pi options** JSON editor accepts `compat`, `thinkingLevelMap`,
`inputLimits`, `promptCache` and `samplingParams` in Pi's own formats. Saul
preserves these objects and Pi interprets them. Arbitrary credential headers,
custom protocol implementations and automatic endpoint model discovery are not
part of this UI. Custom model costs initially default to zero (unknown), not a
claim that provider usage is free.

Pi's environment credentials and native credential-file sources remain usable.
Optionally set `SAUL_AI_PROVIDER` and `SAUL_AI_MODEL` to bootstrap a default when
no AI configuration record exists. This requires configured provider auth.
Existing Azure deployment environment settings are recognized too; unknown
Azure deployment IDs default to text-only input unless
`AZURE_OPENAI_INPUT=text,image` is set. Saved AI configuration takes precedence
over default bootstrap variables. Restart after changing `.env`.

## Persistence and scope

Native Pi credentials, custom model catalogs, default selection and the stable
installation device ID are encrypted with AES-256-GCM in the existing app
database `secrets` table. Each record has a random nonce and authentication bound
to its record name. Credentials are never returned by the management API or
copied to `process.env`. Losing the encryption key makes these records
unrecoverable. Invalid managed ciphertext stops startup, rather than falling
back silently. Encryption does not protect a compromised running server.

Configuration changes apply live. New conversations capture the current
`{provider, modelId}`; existing conversations and forks keep their stored
selection. If a saved model becomes unavailable, Saul reports it instead of
changing the model automatically. A provider serving the active default cannot
be deleted until another default is chosen. Disconnect removes the stored
credential, but environment or native file credentials may still make it usable.
Replacing a connection cancels pending logins. Changing its base URL or API
family also clears stored credentials so an old key cannot be sent to a new
endpoint. Renaming a connection or editing its model metadata preserves auth.
Requests already in flight may finish with previous credentials/configuration.

Credential updates and OAuth refresh are serialized per provider so concurrent
requests do not refresh a rotated token twice. This storage assumes **one active
backend process**, as does the Pi harness; it is not a multi-instance credential lock.
Custom providers and their native credentials are restored every server boot.
AI configuration lives in the app database; conversation model references live
in Pi storage. Back up both databases and the encryption key together.

The old `/api/secrets` API is removed. Old Azure, S3 and email rows remain
untouched but are ignored. Reconnect AI providers through Settings or supply
their environment credentials. Put Resend and S3 values in `.env` before an
upgrade if they were previously configured only in the UI. No database reset,
credential export or automatic legacy conversion runs.

Keep `RESEND_API_KEY`, `MY_EMAIL_ADDRESS`, S3 configuration, database URLs/tokens,
signing keys, server port and deployment mode outside Settings. Android is not
updated by this feature and its previous raw-settings UI is not compatible with
the removed API.

## API and security

All `/api/ai` endpoints require a fresh administrator session. Invalid bearer
credentials cannot fall back to cookies. Cookie-authenticated mutations require
the `/csrf-token` cookie and `x-csrf-token` header. Responses use `no-store`;
errors contain safe messages, not provider responses or credentials. Mutations
are limited to 30 per minute per IP; login polling is excluded from this limit.

- `GET /api/ai`: default model, provider metadata, configured credential status,
  offered native login methods and custom API families.
- `GET /api/ai/providers/:id/models`: native chat model catalog without headers.
- `PUT /api/ai/default`: `{provider, modelId}`; registered model and configured
  auth required.
- `PUT /api/ai/providers/:id`: custom `{name, baseUrl, api, keyless, models}`;
  built-in provider IDs cannot be replaced. Models use Pi's native fields.
- `DELETE /api/ai/providers/:id`: delete a custom connection and its credential.
- `DELETE /api/ai/providers/:id/credential`: native logout.
- `POST /api/ai/providers/:id/login`: `{method: "api_key" | "oauth"}`.
- `GET /api/ai/logins/:id`: state, native events and pending prompt, without
  submitted answers. Sessions belong to the administrator who created them.
- `POST /api/ai/logins/:id/answer`: `{promptId, value}` for that pending prompt.
- `DELETE /api/ai/logins/:id`: cancel a pending login.

Login sessions expire after ten minutes and are cancelled on navigation where
possible. UI drafts stay in component memory, not browser storage. Some OAuth
flows start a **localhost callback on the server**, which is not the browser's
localhost when Saul runs on a VPS. Use Pi's manual code/URL prompt where offered;
otherwise the login must be completed on the server host. This UI does not
implement a new public OAuth callback proxy.

## Local verification

Run from the repository root:

```powershell
node --test server/test/*.test.ts web/test/*.test.ts
npx tsc --noEmit
npm run build --prefix web
```

The deterministic AI test uses disposable local databases and a local
OpenAI-compatible endpoint. It checks native generation, reboot persistence,
encrypted credentials, serialized OAuth refresh, admin/CSRF boundaries, login
cancellation and new-versus-existing conversation defaults. It does not exercise
real account authorization, model access, remote database recovery or production
deployment. Use a disposable installation for manual credential/default tests;
never replace working production credentials just to verify UI controls.
