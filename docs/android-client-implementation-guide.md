# Native Android client: architecture and delivery guide

This is the source of truth for Android product scope and implementation order. Before changing Android code, read this document, `AGENTS.md`, `android/README.md`, and the Android CLI skill at `.agents/skills/android-cli/SKILL.md`.

## Goal

Build a native Jetpack Compose client that has the same product behavior and visual language as the web client while using Android-native navigation, accessibility, lifecycle, and adaptive-layout patterns.

“Identical” means:

- the same information hierarchy, colors, typography, spacing rhythm, message states, and actions;
- the same Gateway-owned conversations, messages, tasks, approvals, and settings;
- equivalent behavior for loading, streaming, reconnecting, failure, and empty states;
- native Android controls and system behavior rather than a WebView or a literal port of DOM components.

The Android app is a client of the Express Gateway. It must never connect directly to an AI provider or duplicate agent workflow logic.

```text
Compose UI
  -> screen ViewModel
  -> repository
  -> Ktor HTTP/SSE + local storage
  -> Express Gateway
  -> Pi-Durable
```

## Recommended approach

Build vertical slices in this order:

1. finish and harden the native device-authorization flow;
2. exact theme and app shell;
3. conversation list and navigation;
4. read-only transcript plus live SSE snapshots;
5. send and stream one response;
6. thinking, tool activity, effects, and forks;
7. tasks and settings;
8. caching and reconnect recovery;
9. Android-only features such as notifications, share targets, voice input, and shortcuts.

Do not build every screen before the transport works. Each slice must compile, have a focused automated test, run on an emulator, and have a visually inspected screenshot.

## Current repository audit

### Toolchain

The project under `android/` already exists and builds. Its recorded baseline is:

| Concern              | Current choice                                        |
| -------------------- | ----------------------------------------------------- |
| UI                   | Jetpack Compose + Material 3                          |
| Navigation           | Navigation 3                                          |
| HTTP                 | Ktor Client Android engine                            |
| State                | Coroutines and `StateFlow`                            |
| Dependency injection | Manual `AppContainer`                                 |
| Min SDK              | 24                                                    |
| Compile/target SDK   | 37                                                    |
| App module           | One `:app` module                                     |
| Android CLI          | Installed; version is reported by `android --version` |

Do not copy these versions into another file. `android/gradle/libs.versions.toml`, the Gradle wrapper, and `android/README.md` are authoritative.

The local Android CLI currently sees `Medium_Phone_API_36.1`. The local Gradle build requires Android Studio’s JBR. In Git Bash:

```bash
export JAVA_HOME='/c/Program Files/Android/Android Studio1/jbr'
export PATH="$JAVA_HOME/bin:$PATH"
cd android
./gradlew.bat testDebugUnitTest lintDebug --console=plain
```

The baseline unit tests and Android lint pass with that JDK. Connected tests were not part of this documentation pass.

### Implemented Android behavior

The Android app currently has:

- a single `MainActivity` with edge-to-edge enabled;
- separate authenticated and unauthenticated Navigation 3 stacks;
- a manual dependency container;
- Ktor health and JSON support;
- a device-code repository that requests and polls Better Auth endpoints;
- Custom Tab launch from the sign-in screen;
- encrypted-preferences token storage as a prototype;
- a placeholder authenticated home screen;
- basic unit and Compose UI tests.

The current backend/web implementation now has:

- Better Auth `deviceAuthorization()` and `bearer()` plugins;
- a `deviceCode` Drizzle model;
- a `/device` verification and approval page;
- the standard `/api/auth/device/*` endpoints supplied by Better Auth.

It does not yet have conversations, chat, SSE, markdown, tasks, settings, caching, attachments, approvals, or notifications on Android.

### Remaining authentication work

The backend foundation is configured, but the flow is not production-complete. Finish these items before starting protected feature work:

1. Add and apply a reviewed Drizzle migration for `deviceCode`; a schema declaration alone does not update deployed databases.
2. Add `validateClient` and standardize the client ID. Android currently sends `android-client`; reject every other first-party client ID.
3. Make `/device` reachable before `AuthGate`, or preserve `/device?user_code=...` through login and return to it after authentication. The current root gate/login redirect path does not do this reliably.
4. Remove the obsolete `client=android` branch in `web/src/routes/login.tsx`; it still attempts to place a session token in `saul://auth`.
5. Replace the manual `test-bearer.ts` script with automated integration tests. The script currently prints device codes, bearer tokens, and SSE data and must not be retained as a security test.
6. Define bearer-versus-cookie CSRF behavior. `POST /api/chat` still requires cookie-bound double-submit CSRF, so a valid Android bearer request can authenticate and still fail the mutation.
7. Make Android polling handle `slow_down`, cancellation, network retry, non-2xx error bodies, and app lifecycle changes.
8. Make sign-out revoke the Better Auth server session before clearing local state. The current implementation only clears local storage.
9. Replace the alpha/deprecated `EncryptedSharedPreferences` prototype with direct Android Keystore-backed encryption using stable platform APIs.
10. Add authenticated HTTP and SSE tests proving `createAuthGuard()` resolves the bearer identity.
11. Remove request-body and settled-result debug logs from `src/controllers/chat.ts` before testing private conversations.
12. Replace the warm Android theme with the web slate/crimson design system.

Treat `docs/specs/001-android-auth-flow.md` as the focused auth requirements document and update its status when this completion list passes.

## Actual web and Gateway capability matrix

This matrix separates visible web features from server-ready contracts. Android parity can only use behavior the Gateway actually supports.

| Capability                    | Web        | Gateway today                           | Android priority    |
| ----------------------------- | ---------- | --------------------------------------- | ------------------- |
| Email/password account flows  | Yes        | Better Auth routes                      | Auth browser flow   |
| Session-cookie authentication | Yes        | Yes                                     | Browser only        |
| Native bearer authentication  | In progress | Better Auth plugins configured          | Finish and verify   |
| Conversation list             | Yes        | `GET /api/conversations`                | P1                  |
| Create conversation           | Yes        | `POST /api/new-thread`                  | P1                  |
| Rename conversation           | Yes        | `PATCH /api/conversations/:id`          | P1                  |
| Delete conversation           | Yes        | `DELETE /api/conversations/:id`         | P1                  |
| Fork from message             | Yes        | `POST /api/fork/:messageId`             | P2                  |
| Initial transcript            | Yes        | Initial event from `GET /api/stream`    | P1                  |
| Live text/thinking            | Yes        | Full Pi-Durable view snapshots over SSE | P1                  |
| Send/steer                    | Yes        | `POST /api/chat`, `whenBusy`            | P1                  |
| Stop generation               | UI only    | Web handler is still a TODO             | Blocked             |
| Tool activity                 | Yes        | Derived from Pi entries/live state      | P2                  |
| Approval UI                   | Yes        | Approval routes exist                   | P2                  |
| Task list/abort               | Yes        | `/api/tasks` routes exist               | P2                  |
| Secrets/settings              | Yes        | `/api/secrets` routes exist             | P3, sensitive       |
| Attachments                   | UI present | `/api/artifacts` is not mounted         | Blocked             |
| Offline cache                 | No         | No sync protocol                        | Android enhancement |
| Background notifications      | No         | No push contract                        | Future backend work |

Do not advertise Stop, attachments, replay-safe offline sending, or push notifications in Android until their server contracts exist.

## Product naming decision

The repository and user-facing terminology currently mix **Saul** and **Lali**:

- repository and deep-link scheme: Saul;
- Android application/package strings and web brand: Lali.

Choose one product name before polishing icons, accessibility labels, App Links, package metadata, and Play Store assets. Until that decision, match the current web-visible name, **Saul**, and avoid adding more naming variants.

## Architecture

### Keep one app module initially

Use one `:app` Gradle module until build time or ownership becomes a real problem. Organize packages by responsibility:

```text
io.github.gajendrasinghdawar.saul/
  app/
    AppContainer.kt
    LaliApplication.kt
    MainActivity.kt
    navigation/
  core/
    auth/
    database/
    design/
    markdown/
    model/
    network/
  data/
    auth/
    conversations/
    chat/
    tasks/
    settings/
  feature/
    signin/
    conversations/
    chat/
    tasks/
    settings/
  ui/
    components/
    theme/
```

Do not introduce feature Gradle modules, Hilt, or a generic “clean architecture” use-case layer preemptively. Manual constructor injection is sufficient until navigation-scoped ViewModels or WorkManager construction becomes repetitive.

### Layer rules

- Composables receive immutable state and emit callbacks.
- Screen ViewModels expose one `StateFlow<UiState>` and accept explicit actions.
- ViewModels call repositories, never Ktor, Room, DataStore, or Android framework storage directly.
- Repositories own reconciliation between network and local data.
- Network DTOs stay in the network/data layer.
- Domain/UI models use sealed interfaces and data classes, never `Map<String, Any>`.
- The Gateway remains authoritative. A local database is a projection/cache, not a second conversation engine.
- Collect flows with `collectAsStateWithLifecycle()`.
- Use stable durable IDs as `LazyColumn` item keys.

This follows the official Android architecture guidance: a clear data layer, repositories, unidirectional data flow, screen-level ViewModels, coroutines/Flow, lifecycle-aware collection, and a single activity.

### Suggested interfaces

```kotlin
interface AuthRepository {
  val session: StateFlow<AuthSession?>
  suspend fun beginSignIn(): SignInChallenge
  suspend fun completeSignIn(result: AuthResult)
  suspend fun signOut()
}

interface ConversationRepository {
  fun conversations(): Flow<List<ConversationSummary>>
  suspend fun refresh()
  suspend fun create(): ConversationId
  suspend fun rename(id: ConversationId, title: String)
  suspend fun delete(id: ConversationId)
}

interface ChatRepository {
  fun conversation(id: ConversationId): Flow<ConversationState>
  suspend fun connect(id: ConversationId)
  suspend fun disconnect(id: ConversationId)
  suspend fun send(id: ConversationId, text: String, requestId: String)
  suspend fun fork(messageId: MessageId): ConversationId
}
```

These interfaces describe behavior, not transport. Implement them only as each vertical slice needs them.

## Authentication design

Authentication is the first backend-and-Android slice.

### Recommended flow

The project has selected Better Auth’s first-party device authorization flow. `src/auth/auth.ts` now configures `deviceAuthorization({ verificationUri: '/device' })` and `bearer()`. This is the correct base for the Android client: the browser owns user authentication and approval, while Android receives a Better Auth session token by polling.

Preferred trace:

```text
Android requests a short-lived device challenge
-> Android opens the Gateway verification URL in a Custom Tab
-> user signs in using the existing web flow
-> authenticated web page approves the displayed device/user code
-> Android polls the token endpoint at the server-provided interval
-> Gateway returns a Better Auth session token once
-> Android encrypts it with an Android Keystore key
-> Ktor adds Authorization: Bearer ... to API and SSE requests
```

The device flow does not need a callback deep link. Android opens the verification page and independently polls the token endpoint. This removes the custom-scheme interception problem.

### Implemented endpoint contract

Because Better Auth is mounted at `/api/auth`, Android uses:

| Step | Method and endpoint | Important fields |
| --- | --- | --- |
| Request codes | `POST /api/auth/device/code` | `client_id: "android-client"` |
| Verify/claim in browser | `GET /api/auth/device?user_code=...` | authenticated browser cookie |
| Approve in browser | `POST /api/auth/device/approve` | `userCode` |
| Deny in browser | `POST /api/auth/device/deny` | `userCode` |
| Poll from Android | `POST /api/auth/device/token` | RFC 8628 grant type, `device_code`, `client_id` |

The code response contains `device_code`, `user_code`, `verification_uri`, `verification_uri_complete`, `expires_in`, and `interval`. A successful token response returns `access_token`, `token_type`, `expires_in`, and `scope`. For this standalone first-party flow, `access_token` is a Better Auth session token.

Android must honor the returned interval and these terminal/intermediate errors:

- `authorization_pending`: continue at the current interval;
- `slow_down`: increase the interval by five seconds;
- `access_denied`: stop and show denial;
- `expired_token`: stop and offer restart;
- `invalid_grant`: discard the challenge.

### Server completion work

- validate the single supported Android client ID;
- apply the `deviceCode` database migration;
- make the browser verification/login return path deterministic;
- remove the old token-in-deep-link login path;
- define bearer-authenticated mutation handling alongside browser CSRF;
- add server-side sign-out/revocation and later device-session management;
- return consistent `401` versus `403` errors;
- test HTTP and SSE with the same bearer identity;
- redact tokens, authorization headers, device codes, and private payloads from logs.

### Android storage

The current Android prototype has moved from plaintext preferences to `EncryptedSharedPreferences`, but that dependency/API is alpha and deprecated. Replace the prototype with:

- an AES key generated directly in `AndroidKeyStore`;
- encrypted token bytes in private app storage or DataStore;
- no backup for bearer material unless a deliberate credential restore design exists;
- complete token and user-cache removal on sign-out or unauthorized response.

The Keystore protects key material from extraction; perform cryptographic operations off the main thread. StrongBox is optional, not a baseline requirement.

### Browser handoff

Open `verification_uri_complete` in a Custom Tab. No app callback is required: polling completes the flow even when the browser remains open. Keep Android App Links for future notification/chat deep links, not for transporting authentication credentials.

## Gateway contract strategy

### First release: consume the current snapshot stream

The current `GET /api/stream?conversationId=...` endpoint sends:

```text
data: { "type": "init", "view": <Pi Durable view> }

data: { "type": "update", "view": <Pi Durable view> }
```

Each update is a complete current projection, not a token delta. Android must rebuild or diff its immutable UI projection from that snapshot. It must not append the entire partial response to the previous partial response, or text will duplicate.

The mapper must match `web/src/features/chat/chat-view.ts`:

- `pi.user` becomes a user message;
- consecutive `pi.assistant` entries and tool results form the assistant turn;
- `text` parts become visible answer text;
- `thinking` parts become expandable thinking content;
- `toolCall` parts become activity items;
- `docs["pi.live"].run` is the authoritative busy state;
- `docs["pi.live"].generation.message` is the current partial assistant response;
- when live state disappears and the assistant entry is committed, render one completed message, not both versions.

Create shared JSON fixtures captured from sanitized Gateway views. Run the same cases through the web mapper and Android mapper. Required fixtures:

1. user message only;
2. live thinking only;
3. live text growing across snapshots;
4. tool call, running result, and final answer;
5. completed response replacing its live version;
6. malformed/unknown content part;
7. unauthorized and disconnected stream.

### Current SSE limitations

The endpoint currently has no event IDs, replay cursor, explicit heartbeat, or typed stable public schema. Therefore:

- reconnect by requesting a fresh complete snapshot;
- never resend a user command merely because SSE reconnects;
- keep one SSE connection only while the chat destination is started/visible;
- use bounded exponential backoff with jitter for transient failures;
- stop retries on `401` and return to re-authentication;
- treat malformed snapshots as an error and retain the last valid UI state.

Do not use WorkManager to hold an SSE connection. WorkManager is for bounded deferrable work, not a permanent foreground stream.

### Contract hardening before offline-first chat

Before durable offline history or background notifications, add a versioned client-neutral contract. At minimum it needs:

- an explicit schema version;
- stable DTOs independent of Pi-Durable internals;
- event identity or snapshot generation;
- history/live handoff without a race;
- reconnect/replay semantics;
- idempotency key acceptance for message submission;
- cancellation semantics and terminal run status;
- attachment upload limits and metadata.

Keep contract fixtures in the repository and test both TypeScript serialization and Kotlin decoding. Avoid maintaining unrelated hand-written interpretations in two clients.

## Network implementation

Add dependencies only when their slice begins:

- Ktor Content Negotiation + Kotlin serialization for JSON;
- Ktor SSE for the chat stream;
- a redacting logger only in debug, or no HTTP body/header logger;
- AndroidX DataStore for non-secret preferences and drafts;
- Room when cached conversations/transcripts are implemented;
- Custom Tabs for browser auth.

Configure one application-scoped `HttpClient` with:

- base URL from `BuildConfig`;
- bearer injection from `AuthRepository`;
- connect/request/socket timeouts appropriate to normal requests;
- a separate long-lived SSE request policy;
- JSON that rejects or safely ignores unknown fields according to the versioning policy;
- response mapping for unauthorized, forbidden, rate limited, server, and connectivity errors.

Do not catch only `IOException`: Ktor failures and serialization failures need deliberate mapping. Do not log request bodies, cookies, bearer headers, thinking text, or private transcript content.

For local development:

- emulator to host: `http://10.0.2.2:3000`;
- physical USB device: `adb reverse tcp:3000 tcp:3000`, then use `http://localhost:3000`;
- production: HTTPS only;
- cleartext exceptions remain debug-only.

## Navigation and adaptive shell

Keep Navigation 3. Use serializable `NavKey` values and a saveable back stack. Model authentication as two root flows:

```text
Unauthenticated: SignIn
Authenticated: ConversationList -> Chat(id), Tasks, Settings
```

When auth changes, replace the root flow rather than expecting a remembered start destination to change.

### Phone

- top app bar with Lali identity and current destination;
- modal navigation drawer for New chat, Tasks, Settings, account, and conversations;
- chat occupies the full screen;
- back from chat returns to the conversation list/drawer selection behavior defined by the navigation graph;
- composer respects IME and navigation-bar insets.

### Wide window/tablet/foldable

Use an adaptive list-detail layout:

- conversation list/navigation pane on the left;
- selected chat detail on the right;
- Tasks and Settings remain top-level destinations;
- preserve selected conversation and draft across window-size changes.

Do not hardcode “phone/tablet” from device type or orientation. Adapt to available window size. Navigation 3’s list-detail scene or Material adaptive `NavigableListDetailPaneScaffold` are valid options; prototype both against the current stable dependencies before choosing one.

## Exact design-system parity

The repository rule requires Android to be visually identical to web. The web source of truth is:

- colors: `web/src/styles/theme.css`;
- typography: `web/src/styles/typography.css`;
- global surfaces and behavior: `web/src/styles/global.css`;
- message composition: `web/src/components/message.tsx`;
- chat rows: `web/src/features/chat/`;
- shell/sidebar: `web/src/components/ui/sidebar/` and `SessionSidebar.tsx`.

The current Android warm terracotta theme must be replaced. Start dark-only because the current web root declares a dark color scheme. Add light mode only when the web app has an equivalent approved light palette.

Create Compose tokens with the same semantic names and values, for example:

| Web token                  | Use in Android                      |
| -------------------------- | ----------------------------------- |
| `slate2` `hsl(220 6% 10%)` | app/background surface              |
| `slate3` `hsl(225 6% 14%)` | elevated field/card surface         |
| `slate4`–`slate7`          | selected, hover-equivalent, borders |
| `slate10`                  | secondary labels                    |
| `slate11`                  | body text                           |
| `slate12`                  | high-emphasis text                  |
| `crimson9`–`crimson11`     | brand and primary emphasis          |
| `jade9`–`jade11`           | connected/running/success           |
| `amber9`–`amber11`         | warning/pending                     |
| `red9`–`red11`             | destructive/error                   |

Keep raw palette values in one Kotlin file and expose semantic `ColorScheme`/component tokens from another. Do not scatter color literals through feature code.

Use Noto Sans on Android to match web. Bundle the required weights so appearance is deterministic offline. Mirror web measurements intentionally:

- content width equivalent to web `max-w-4xl` on wide screens;
- composer narrower than the transcript on wide screens;
- user bubble up to roughly 85% width;
- assistant content flat/full-width rather than a large colored bubble;
- 8dp/12dp/16dp spacing rhythm;
- subtle one-pixel slate borders;
- restrained corner radius and shadow;
- crimson brand accent, jade live status, amber pending state;
- reduced motion respected.

Maintain a parity gallery containing the same fixture states in web and Compose previews:

- empty chat;
- short user/assistant exchange;
- long Markdown answer;
- table wider than phone viewport;
- fenced code block;
- streaming thinking;
- tool activity;
- approval card;
- reconnecting and failed states;
- long titles and large font scale.

Capture screenshots at phone and wide-window dimensions. Compare hierarchy, wrapping, spacing, color, and action placement. Pixel identity is not required where Android system controls differ; semantic and visual identity is.

## Native message and Markdown rendering

Do not use a WebView merely to reuse Streamdown. Build a native Compose message list:

```text
LazyColumn
  UserMessage
  AssistantMessage
    ThinkingDisclosure
    MarkdownContent
    ToolActivity
    ApprovalCard
    MessageActions
```

Requirements:

- stable key per durable message/entry;
- one assistant row updated as partial content grows;
- `contentType` per row type for efficient reuse;
- auto-scroll only if the user is already near the bottom;
- a “new messages” affordance when the user is reading older content;
- thinking expanded while active and collapsed when complete;
- no TalkBack announcement per token; announce state changes such as “response complete”;
- copy, select, share, and fork actions;
- horizontal scrolling for wide tables and code, never whole-screen overflow.

Compose has no official Streamdown equivalent. Before choosing a Markdown library, run a small spike against Saul’s real fixtures. Candidate libraries must provide native Compose rendering, incremental updates without duplicating prior blocks, GFM tables, fenced code, links, selection, accessibility semantics, dark-theme customization, and an acceptable license. Current candidates found during research include `ComposeMarkdownMultiplatform`, `compose-markdown`, and `multiplatform-markdown-renderer`; none is approved by this guide. Inspect current source, release activity, transitive dependencies, and API types before selection. use https://github.com/mikepenz/multiplatform-markdown-renderer

If no candidate passes, implement the limited syntax Saul actually emits rather than importing a large browser engine. Keep parsing outside composables and expose an immutable Markdown block model.

## Screen behavior

### Conversation list

- sort by server `updated` descending, matching web;
- always expose Main Thread;
- create, rename, delete, and select;
- confirm destructive deletion;
- preserve selected conversation on wide layouts;
- show loading, empty, stale-cache, unauthorized, and retry states.

### Chat

Recommended `ChatUiState`:

```kotlin
data class ChatUiState(
  val conversationId: String,
  val items: List<ChatItem>,
  val draft: String,
  val connection: ConnectionState,
  val run: RunState?,
  val isInitialLoading: Boolean,
  val error: UserVisibleError?,
)
```

Composer behavior:

- multiline input;
- IME Send sends; Shift+Enter/hardware behavior is tested;
- retain draft on failed submission;
- optimistic user row reconciles with canonical state by request/idempotency key, not only matching text;
- show connection/generation status with the same meaning and colors as web;
- attachment and Stop buttons appear only when their server behavior exists.

### Tasks and approvals

- tasks use typed state, not raw JSON in the primary UI;
- raw checkpoint details may be expandable debug information;
- approval cards explain the action before Approve/Reject;
- Android sends the decision, while the Gateway executes the effect;
- destructive or costly approvals may require device authentication later.

### Settings

The web settings screen manages server secrets. This is high-risk functionality on mobile. Implement it after chat parity, with:

- masked values;
- no secret values in screenshots, recents, clipboard by default, logs, or accessibility announcements;
- explicit confirmation and re-authentication for destructive changes;
- admin authorization enforced by the Gateway, not hidden buttons alone.

## Offline and lifecycle policy

Start online-first. Add Room only after the canonical online chat slice is correct.

When caching is added:

- Room is the UI’s observable local source for conversation/timeline projections;
- Gateway snapshots update Room transactionally;
- scope all rows by authenticated user;
- clear sensitive cache at sign-out;
- preserve per-conversation drafts in DataStore or Room;
- mark stale content honestly;
- message sending remains online-only until the Gateway has idempotency and an explicit offline queue contract.

SSE lifecycle:

```text
Chat destination STARTED
-> open stream
-> parse snapshot
-> commit projection
-> update StateFlow

Destination stopped
-> close stream

Destination started again
-> reconnect and receive a fresh snapshot
```

Do not keep SSE alive from WorkManager or an unbounded foreground service. Future background alerts require a separate push-notification contract, normally FCM plus a server-side device registration/revocation model.

## Delivery plan

### Slice 0 — complete device authorization

The plugin configuration, web approval screen, Android code request/polling, auth-driven navigation, and prototype encrypted storage now exist.

Finish:

- database migration;
- canonical `android-client` validation;
- browser login return to `/device`;
- deletion of the old token-in-deep-link path;
- stable Keystore-backed token encryption;
- polling state/error/cancellation handling;
- remote sign-out/revocation;
- automated backend, repository, and Compose tests.

Done when sign-in, process restart, expiry, denial, slow-down, sign-out, and revocation pass without a credential appearing in URLs, logs, screenshots, or test output.

### Slice 1 — prove authenticated Gateway access

Use the resulting bearer token with `GET /api/auth/get-session`, `GET /api/conversations`, and `GET /api/stream`. Resolve bearer mutation/CSRF handling and prove one protected POST request.

Done when the same bearer identity works for normal HTTP, SSE, and an authorized mutation, while invalid/revoked tokens consistently return `401`.

### Slice 2 — design system and adaptive shell

Translate web tokens and build reusable Compose primitives: app surface, brand mark, navigation item, button variants, dialog, status dot, input, message action, and responsive shell.

Done when fixture screenshots match the web hierarchy on a phone and a wide emulator and accessibility checks pass.

### Slice 3 — conversations

Implement list/create/rename/delete and Navigation 3 destinations with fake-first repository tests, then real Gateway wiring.

Done when refresh and all mutations reconcile with server state and a device journey passes.

### Slice 4 — read-only chat stream

Add Kotlin serialization DTOs, Ktor SSE, the Pi snapshot mapper, and the Compose message list. Use sanitized snapshots in unit tests before opening a real stream.

Done when a message sent from web appears once on Android, including incremental thinking and text.

### Slice 5 — sending

Add draft state, optimistic submission, server reconciliation, busy/steer behavior, error recovery, and scroll anchoring.

Done when both HTTP-before-SSE and SSE-before-HTTP orderings produce one user message and one assistant response.

### Slice 6 — parity actions

Add forks, tool activity, approvals, task list/abort, and account menu. Add settings only after authorization is explicit.

Done when each action is confirmed by canonical server state, not only optimistic UI.

### Slice 7 — cache and resilience

Add Room, stale-state UI, reconnect backoff, process-death restoration, and per-conversation drafts.

Done when airplane-mode and Gateway-restart journeys retain readable history without duplicate messages or command replay.

### Slice 8 — server-enabled missing features

Implement cancellation and attachments only after backend contracts and tests exist.

### Slice 9 — Android advantages

Prioritize based on actual use:

- share text/files into a selected conversation;
- notification deep links for scheduled briefings and completed long runs;
- voice input through Android system speech UI;
- app shortcuts for Main Thread and New chat;
- biometric app lock for local privacy;
- offline conversation search;
- App Functions for safe, narrowly scoped actions;
- tablet/foldable two-pane productivity UI.

Each feature must use Gateway authorization and must not expose arbitrary agent execution through an unauthenticated Android surface.

## Agentic Android development loop

### 1. Orient

From the repository root:

```bash
android --version
android info
android sdk list
android skills list
android describe --project_dir=android
```

On this Windows machine, set `JAVA_HOME` before commands that invoke Gradle. Do not run several first-time `android docs` searches concurrently: index initialization uses a filesystem lock.

For a new task, search official docs and discover a matching skill:

```bash
android docs search "specific API or behavior"
android docs fetch "kb://selected/result"
android skills find <topic>
```

Relevant skills currently available include `navigation-3`, `adaptive`, `edge-to-edge`, `testing-setup`, `android-intent-security`, and `appfunctions`. Install/read only the skill required by the active slice.

### 2. Define one user trace

Write the success path and one principal failure path before coding. Example:

```text
Open conversation
-> initial cached/snapshot content appears
-> Gateway streams a growing assistant response
-> one assistant row updates in place
-> final snapshot marks it complete

Failure: disconnect halfway
-> existing text remains
-> status becomes Reconnecting
-> fresh snapshot replaces partial state without duplication
```

Turn the trace into a unit/integration test at the mapper or repository boundary before building the screen.

### 3. Implement fake-first

- define domain state and repository interface;
- create a fake repository that can emit deterministic states;
- build stateless screen composables and previews;
- add ViewModel behavior;
- add DTO/Ktor/Room implementation last.

This keeps Compose previews and tests independent of a live Gateway or paid model.

### 4. Run the tight test loop

```bash
cd android
./gradlew.bat testDebugUnitTest --console=plain
./gradlew.bat lintDebug --console=plain
./gradlew.bat assembleDebug --console=plain
```

For UI changes:

```bash
./gradlew.bat connectedDebugAndroidTest --console=plain
```

Do not use a paid model in deterministic tests. Use Ktor `MockEngine`, fake repositories, and recorded sanitized SSE snapshots.

### 5. Deploy and inspect

Start the existing emulator using the current CLI help. If `android emulator start` is unavailable on Windows, use the SDK emulator executable documented in `android/README.md`.

Build/deploy:

```bash
android run \
  --apks=android/app/build/outputs/apk/debug/app-debug.apk \
  --device=emulator-5554
```

Inspect semantics first:

```bash
android layout --device=emulator-5554 --pretty
android layout --device=emulator-5554 --full --pretty
```

The current CLI marks `layout --diff` as deprecated/no-op, so do not rely on it despite older skill text.

Capture and visually inspect every changed screen:

```bash
android screen capture \
  --device=emulator-5554 \
  --output=docs/screenshots/android/chat.png
```

Use annotated screenshots only when layout semantics cannot locate a target:

```bash
android screen capture --annotate \
  --device=emulator-5554 \
  --output=docs/screenshots/android/chat-annotated.png
android screen resolve \
  --screenshot=docs/screenshots/android/chat-annotated.png \
  --string="tap #3"
```

Then execute the returned action with `adb shell input`. Before text input, verify the field is focused. Encode spaces as `%s`, use key event 66 for Enter, and scroll slowly.

### 6. Evaluate a journey

Store deterministic journeys under `android/journeys/`. Example:

```xml
<journey name="Stream a response">
  <description>Send one message and observe one incremental response.</description>
  <actions>
    <action>Launch Lali while signed in to the test Gateway</action>
    <action>Tap Main Thread</action>
    <action>Tap the Message field</action>
    <action>Enter "Explain SSE briefly"</action>
    <action>Tap Send</action>
    <action>Verify that one pending user message is visible</action>
    <action>Verify that one assistant message grows while generation is active</action>
    <action>Verify that the status changes to Ready when generation completes</action>
  </actions>
</journey>
```

Evaluate actions exactly in order. A missing control, crash, freeze, or unmet assertion fails the journey. Record commands, screenshots, and comments in a Markdown result file.

### 7. Compare parity

For every visual slice:

1. create identical fixture content on web and Android;
2. capture phone and wide Android screenshots;
3. compare layout hierarchy, colors, typography, spacing, wrapping, states, and actions;
4. inspect `android layout` for labels, roles, focusability, and touch targets;
5. test font scaling, TalkBack, portrait/landscape, keyboard/IME, and reduced motion;
6. keep screenshots that document accepted states.

### 8. Completion gate

A slice is complete only when:

- its user trace works on an emulator or physical device;
- its principal failure trace is automated;
- unit tests, lint, build, and relevant connected tests pass;
- changed screens were inspected through both layout output and screenshots;
- no secrets or private transcript payloads appear in logs/artifacts;
- web behavior still works if Gateway code changed;
- deferred backend requirements are stated rather than simulated in Android.

## Testing pyramid

### Unit tests

- snapshot-to-chat projection;
- partial-to-final deduplication;
- unknown content parts;
- ViewModel loading/content/error transitions;
- draft persistence;
- auth expiration;
- idempotent optimistic reconciliation;
- reconnect backoff with virtual time.

### Network tests

Use Ktor `MockEngine` for normal HTTP. Use a local in-process test server for SSE framing and cancellation when MockEngine cannot reproduce streaming behavior.

Verify:

- bearer header injection and redaction;
- URL/path/query encoding;
- JSON compatibility;
- SSE initial/update parsing;
- cancellation when destination stops;
- `401`, `403`, `429`, malformed JSON, disconnect, and timeout behavior.

### Compose tests

Test semantics and behavior rather than implementation details:

- navigation destinations;
- selected conversation;
- send enabled state;
- thinking disclosure;
- table/code horizontal scrolling;
- copy/fork/approval actions;
- connection and error announcements;
- minimum touch targets.

Enable Compose accessibility checks and still perform manual TalkBack/Switch Access testing.

### Screenshot tests

Add screenshot testing after the design tokens and core components stabilize. Use deterministic fake data, fixed device profiles, fixed font scale, dark theme, and disabled motion. Keep a small parity matrix rather than snapshotting every screen permutation.

### Performance checks

For long chats and fast partial updates:

- profile recomposition counts;
- verify only the active assistant row changes;
- avoid reparsing the whole transcript in a composable;
- benchmark long Markdown tables/code;
- verify `LazyColumn` scroll position remains stable;
- inspect memory after repeatedly opening conversations.

Use the Android profiler skill and Android Studio profiler for measured regressions.

## Security checklist

Before any non-debug distribution:

- verified HTTPS App Links only;
- no token in URL, logs, screenshots, clipboard, backups, or crash reports;
- Keystore-encrypted bearer material;
- production HTTPS and certificate validation;
- explicit native auth and CSRF policy;
- server-side ownership checks for every conversation/task/secret;
- revocable device sessions;
- cache cleared on sign-out/user change;
- exported activities minimized and incoming intents validated;
- notification content private by default on lock screen;
- no provider API keys in the APK;
- release R8/build and dependency review;
- Play Data Safety and privacy review before publishing.

## Decisions to make before feature coding

Make these decisions explicitly, in order:

1. Confirm the product name and package migration plan: Saul versus the current Lali package/strings.
2. Keep the selected Better Auth standalone device authorization flow, or deliberately upgrade to OAuth Provider tokens before release.
3. What is the stable mobile/client-neutral Gateway DTO version?
4. Is Android dark-only until web has a light theme? yes
5. Which native Markdown renderer passes the fixture spike?
6. Which capabilities are owner/admin-only, especially Secrets?
7. Is offline history required for v1, or only saved drafts and fresh snapshots? offline history required
8. Which Android-only feature provides the first real advantage after parity?

## Recommended first ticket

**Title:** Finish and verify the configured device-authorization flow

**Trace:**

```text
Launch Android app
-> request Better Auth device authorization
-> open verification_uri_complete in a Custom Tab
-> login returns to the device approval page
-> user explicitly approves the displayed client/code
-> Android polls using the server interval
-> Keystore-encrypted session credential is stored
-> authenticated session, conversation-list, and SSE requests succeed
-> process restart remains signed in
-> sign out revokes and clears the credential/cache
```

**Acceptance criteria:**

- no bearer/session token or device code in logs;
- no authentication callback or credential-bearing deep link;
- only the canonical Android client ID is accepted;
- Better Auth device/bearer configuration and database migration are covered by backend tests;
- pending, slow-down, denied, expired, and successful polling are covered by Android tests;
- Ktor authenticated HTTP, mutation, and SSE requests are covered by tests;
- root navigation changes correctly on sign-in/sign-out;
- unit tests, backend tests, lint, build, connected UI test, layout inspection, and screenshots pass.

Do this before implementing the chat UI. It removes the highest-risk uncertainty and gives every later vertical slice a real authenticated transport.

## Primary references

Use these through `android docs search` and `android docs fetch` so the content matches the installed Android Knowledge Base:

- `kb://android/topic/architecture/recommendations`
- `kb://android/develop/ui/compose/architecture`
- `kb://android/topic/architecture/data-layer/offline-first`
- `kb://android/develop/adaptive-apps/guides/list-detail`
- `kb://android/privacy-and-security/risks/unsafe-use-of-deeplinks`
- `kb://android/privacy-and-security/keystore`
- `kb://android/develop/ui/compose/accessibility/testing`
- Navigation 3 skill: install or locate it with `android skills find navigation-3`, then read its `SKILL.md`
- Android CLI interaction rules: `.agents/skills/android-cli/references/interact.md`
- Android CLI journey rules: `.agents/skills/android-cli/references/journeys.md`
