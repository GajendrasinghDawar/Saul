# Native Android client implementation guide

## Purpose

Build a native Android client for Lali. The Android app is a second authenticated client of the existing Express Gateway; it is not a replacement web app and it does not communicate with the model runtime directly.

```text
Android app
  ├─ HTTPS commands and SSE timeline subscription
  └─ no provider credentials, tools, or direct Agent access

Express Gateway
  ├─ authentication and authorization
  ├─ sessions, runs, timeline events, effects, and integrations
  └─ canonical state and SSE replay
```

This guide favors a small, usable personal app over a generic Android platform. Implement one user-visible vertical slice at a time.

## Current Lali facts

Before implementation, verify these facts against current source rather than assuming this guide is current:

- the web client is React/Vite under `web/`;
- the Backend is an Express MVC application under `src/` (using `controllers/`, `routes/`, and `services/`);
- the Backend uses Better Auth with browser-oriented session cookies configured in `src/auth/auth.ts`;
- browser chat uses HTTP commands and SSE (Server-Sent Events) exposed via the Express controllers;
- the Backend owns session metadata, chat queueing, events, effects, email, and background jobs (via Inngest);
- SSE resume, explicit runs, and embedded Pi runtime work are planned in `docs/embedded-pi-migration.md` and must not be bypassed by Android-specific behavior;
- session behavior is specified in `docs/session-ui-ux-spec.md`.

The Android app must consume shared Gateway contracts. Do not duplicate workflow logic, queueing, authorization, or effect execution in Kotlin.

## Product boundary

### Android app owns

- Android navigation and rendering;
- authenticated HTTP/SSE client connection;
- local UI state and temporary drafts;
- offline cache of safe session/timeline projections;
- reconnect behavior and user-visible connection state;
- Android notifications for Gateway-originated events when a later delivery contract exists.

### Gateway owns

- identity and authorization decisions;
- session and run creation;
- canonical event ordering and replay;
- effects, approvals, idempotency, and integrations;
- model/provider credentials;
- durable history and recovery.

## Android platform and agent-tooling baseline

Use current **stable** Android and Kotlin releases when the project is started. Do not pin versions in this document: resolve them from official Android and Kotlin release notes on the day of implementation, record the chosen versions in the Gradle version catalog, and do not introduce alpha/beta/RC app dependencies without explicit approval.

Use Google's Android CLI as the preferred terminal interface for coding agents when it is available on the development host. Android CLI provides structured commands for SDK setup, official project templates, emulators/devices, build/deploy, screenshots/layout inspection, Android documentation, skills, and Android Studio integration. It is currently published as a preview tool, so record the installed CLI version and keep the Gradle wrapper as the reproducible build authority.

Do not confuse tooling stability with app dependency stability: using a preview Android CLI does not permit preview Compose, AndroidX, Kotlin, AGP, or platform APIs in the app.

### Required platform choices

| Concern | Choice |
| --- | --- |
| Language | Kotlin only |
| UI | Jetpack Compose with Material 3 |
| Architecture | UI → ViewModel/state holder → repository → Gateway client/local store |
| Async | Kotlin coroutines and Flow |
| Navigation | Use the current stable Android-recommended Compose navigation stack. Prefer Navigation 3 only when it is stable for the selected toolchain and the official Navigation 3 Android skill applies; otherwise use stable Navigation Compose with typed routes. Record the decision. |
| HTTP | Ktor Client with an Android-supported engine and Kotlin serialization |
| SSE | Ktor Client SSE plugin, subject to a small proof-of-connection spike against Lali's SSE endpoint |
| Local database | Room for cached session/timeline projections |
| Preferences/secrets | DataStore; Android Keystore-backed encrypted storage only for sensitive credential material |
| Background deferrable work | WorkManager only for bounded retry/sync tasks, never an always-open SSE stream |
| Images | No image library in the first chat/session slice unless an actual attachment preview requires one |
| Dependency injection | Small manual `AppContainer` first. Add Hilt only if construction becomes repetitive across multiple screens. |

### Android requirements

- Choose a current supported `minSdk` deliberately. Record why it supports the intended devices and AndroidX dependencies.
- Target the current stable Android SDK available at implementation time.
- Use HTTPS in production. Cleartext HTTP is prohibited outside a debug-only emulator configuration.
- A physical device must not use `localhost` for Gateway access. Provide a development base URL configuration; Android emulator access to a host Gateway normally uses `10.0.2.2`.
- Never log access tokens, cookies, authorization headers, SSE payloads containing private data, or provider credentials.

## Official agent workflow

### Bootstrap and inspect the environment

Before creating or editing the Android project, the coding agent must inspect the locally installed Android CLI rather than assuming commands or SDKs exist:

```text
android update
android info
android sdk list
android skills list
```

Because Android CLI is a preview and its commands may evolve, run `android help` or the command-specific help before automation. Install only the SDK components required by the selected stable compile/target SDK and emulator image. Do not silently upgrade an existing project toolchain during an unrelated feature slice.

### Create the project from an official template

For Demo 0, prefer `android create` and an official Compose template over hand-writing Gradle files. Before running it:

1. inspect `android create --help` and available templates;
2. select Kotlin, Compose, Material 3, and a single app module;
3. create the project under `android/`;
4. record the generated AGP, Kotlin, Gradle, compile SDK, target SDK, and minimum SDK choices;
5. inspect the generated project before adding architecture or dependencies.

If Android CLI is unavailable on the host, use Android Studio's current official New Project Compose template and record that fallback. Do not copy a stale project skeleton from a tutorial.

### Ground the agent with Android Knowledge Base

Use Android CLI's Android Knowledge Base before making API or migration choices:

```text
android docs search "<specific Android question>"
android docs fetch "<selected result>"
```

Search for the concrete task, for example:

```text
current stable Compose edge-to-edge setup
Navigation 3 typed routes stable setup
collect StateFlow lifecycle-aware Compose
Room transactional upsert and cursor update
Android App Links verification
Credential Manager browser sign-in handoff
WorkManager constraints and retry
```

The search result is evidence, not an instruction to adopt a preview API. Confirm release stability and inspect the installed dependency API before coding.

### Install and use official Android skills

Android skills are task-specific `SKILL.md` instructions maintained to ground agents in current Android practices. Manage them through Android CLI:

```text
android skills find <topic>
android skills add <skill-name>
android skills update <skill-name>
```

Install only skills relevant to the current ticket. At minimum, discover official skills when a slice involves:

- Navigation 3 setup or migration;
- edge-to-edge UI;
- AGP 9 migration;
- XML-to-Compose migration;
- R8 configuration analysis.

An installed skill must be read and followed for its matching task. Do not install every skill into context, and do not customize an official skill in place because a later `android skills add` can overwrite it. If Lali eventually needs a project-specific Android workflow, create a separately named skill under a supported project skill directory and keep detailed material in its `references/`, `scripts/`, or `assets/` subdirectories.

### Build, run, and inspect every slice

Use the structured CLI loop where supported:

```text
android run
android layout
android screen capture
android screen resolve
```

The exact options and device-selection arguments must come from current command help. The agent should use these tools to produce visible proof for each demo, not stop after compilation.

Use Android Studio integration when deeper semantic or visual inspection is needed:

```text
android studio check
android studio analyze-file
android studio find-declaration
android studio find-usages
android studio render-compose-preview
android studio version-lookup
```

Do not use an agent as a substitute for Android Studio's profiler, debugger, Layout Inspector, accessibility checks, or release analysis. Open the generated CLI project in Android Studio for visual refinement, profiling, and final production validation.

### Validate user journeys

For completed vertical slices, add an Android CLI Journey where the tooling supports it. A Journey describes a user-visible path in natural language and runs it on a device/emulator. It complements, but does not replace, unit, integration, and Compose tests.

Example first journey:

```text
Launch Lali.
Verify the sign-in screen is visible.
Tap Sign in.
Verify the browser authentication handoff begins.
Return to Lali after successful authentication.
Verify the authenticated app shell is visible.
```

Keep journeys deterministic: use a controlled test Gateway/account, avoid real provider/effect calls, and capture failure screenshots or layout state.

## References to consult before coding

Use primary documentation, Android Knowledge Base results, official Android skills, and installed library APIs—not copied blog-post snippets:

- Android agent tools and Android CLI: `https://developer.android.com/tools/agents`
- Android skills: `https://developer.android.com/tools/agents/android-skills`
- Android CLI Journeys: `https://developer.android.com/tools/agents/android-cli/journeys`
- Android architecture recommendations: `https://developer.android.com/topic/architecture/recommendations`
- Compose architecture: `https://developer.android.com/develop/ui/compose/architecture`
- Offline-first data layer: `https://developer.android.com/topic/architecture/data-layer/offline-first`
- DataStore: `https://developer.android.com/topic/libraries/architecture/datastore`
- WorkManager: `https://developer.android.com/topic/libraries/architecture/workmanager`
- Credential Manager: `https://developer.android.com/identity/credential-manager`
- Ktor Client SSE: `https://ktor.io/docs/client-server-sent-events.html`

Read the current official pages and inspect dependency types in Gradle caches before choosing APIs.

## Authentication is a blocking design decision

The current Gateway authentication configuration is browser-oriented: Email/Password login plus Better Auth session cookies and trusted web origins. A native app cannot safely pretend to be the web browser or share a browser cookie jar as its durable identity mechanism.

Do not begin a production Android chat implementation until the Gateway has an explicit native-client authentication contract.

### Recommended first native auth model: browser sign-in plus device token

Use a device-link flow rather than embedding a traditional cookie manager in the app.

```text
Android app requests a one-time pairing challenge from Gateway
→ app opens the Gateway login/approval page in an Android Custom Tab
→ owner signs in through existing Email/Password Better Auth flow
→ Gateway confirms the pairing and issues a scoped device token
→ app receives a deep-link callback or polls the pairing status
→ app stores only the device token in Keystore-backed storage
→ every API/SSE request authenticates as that device/user
```

The exact Better Auth integration must be researched before implementation. Do not invent token formats, redirects, or cookie transfer mechanisms.

### Minimum Gateway auth requirements

- short-lived pairing challenge with expiry and single use;
- explicit user/device approval and revocation;
- a token scoped to the authenticated Lali user/device;
- `Authorization` handling for HTTP and SSE;
- no token in URL query parameters, logs, timeline events, or notifications;
- Gateway endpoint to revoke/list paired devices later;
- Android App Link callback validation, including state/nonce validation if the design uses redirect callbacks.

### First auth demo

```text
Launch app
→ tap Sign in
→ complete Gateway-owned browser sign-in
→ return to Android app
→ app calls GET /api/me successfully
→ Sign out revokes local credentials and returns to sign-in screen
```

This is a Gateway/API ticket before it is an Android feature ticket.

## App structure

Generate the initial project with Android CLI's current official Compose template as described above, then preserve that template's working build while adding only the files required by the current demo. Keep the Android project in a clearly isolated root directory:

```text
android/
  app/
    src/main/
      AndroidManifest.xml
      java/.../lali/
        LaliApplication.kt
        AppContainer.kt
        core/
          network/
          auth/
          database/
          model/
        data/
          sessions/
          timeline/
          auth/
        feature/
          signin/
          sessions/
          chat/
          settings/
        ui/
          theme/
          components/
          navigation/
      res/
```

Keep feature code close to its screen. Keep protocol/data conversion at the data boundary, not inside composables.

### Module policy

Start with one `:app` module. Do not create feature Gradle modules, a design-system module, or a generic SDK before Android build time or ownership makes them necessary.

## Architecture

Follow unidirectional data flow:

```text
Gateway HTTP/SSE + Room
        ↓
Repository exposes Flow<ScreenData>
        ↓
ViewModel transforms it into immutable UiState
        ↓
Composable renders UiState and emits user actions
        ↓
ViewModel invokes repository command
```

### Rules

- Composables do not call Ktor, Room, DataStore, or Gateway endpoints.
- ViewModels expose one immutable screen `UiState` and process explicit actions.
- Repositories are the single source of truth for the data they own.
- Cache Gateway projections locally; do not treat Room as authority over Gateway state.
- Map network DTOs to app domain models at the repository boundary.
- Do not expose Gateway JSON directly throughout UI.
- Use `SavedStateHandle` only for small navigation/screen restoration values, not whole transcripts.

### Example state shape

```kotlin
data class ChatUiState(
    val sessionId: String,
    val messages: List<ChatItem>,
    val composerText: String,
    val connection: ConnectionState,
    val runState: RunState?,
    val isLoadingHistory: Boolean,
    val error: UserVisibleError?
)
```

Use concrete sealed types for `ConnectionState`, `RunState`, message rows, and user-visible errors. Do not use `Map<String, Any>` or untyped JSON as UI state.

## Shared Gateway contract requirements

Android must not ship a separate interpretation of history and live output. Before the Android chat slice, the Gateway must expose a stable contract shared by web and Android.

### Session list

```text
GET /api/sessions?status=active|archived|all
```

Return typed session projections, including session ID, title, archive status, last update time, active-run status, and timeline generation.

### History and live events

```text
GET /api/chat/events?sessionId=<id>&after=<sequence>
Last-Event-ID: <sequence>

SSE:
id: <sequence>
event: timeline
data: { sessionId, runId, sequence, type, occurredAt, payload }
```

The Gateway must:

1. authenticate every subscription;
2. authorize access to the requested session;
3. replay events after the cursor in sequence order;
4. subscribe without a history/live race;
5. send heartbeats;
6. allow more than one subscriber;
7. retain a canonical event/timeline-generation boundary after reset.

Android stores the largest processed sequence for each `(sessionId, timelineGeneration)` and ignores duplicates. A Gap, invalid JSON, or generation mismatch causes a history refresh rather than local guesswork.

### Commands

Use ordinary authenticated HTTP requests for commands. At minimum:

```text
POST   /api/sessions/start
POST   /api/chat
POST   /api/runs/:runId/cancel
PATCH  /api/sessions/:id          # rename
PUT    /api/sessions/:id/archive
PUT    /api/sessions/:id/restore
POST   /api/sessions/:id/reset
DELETE /api/sessions/:id
POST   /api/sessions/:id/fork
```

Do not add Android-only endpoints when a client-neutral Gateway command is correct.

## Screens and demos

Build demos in order. Each demo must be usable on a physical Android device or emulator and include automated tests for its principal failure case.

### Demo 0: app shell

```text
Use Android CLI's official Compose template
→ launch app through android run
→ Material 3 theme renders edge to edge
→ Sign in placeholder or configuration screen appears
→ configuration can target debug Gateway safely
→ capture and inspect the screen/layout
```

No chat, fake model, or local business logic. This verifies the generated Gradle project, Compose, navigation, edge-to-edge layout, and debug networking. Install and follow the official edge-to-edge skill for this slice if it is available. Preserve system-bar contrast, display-cutout behavior, keyboard insets, and TalkBack semantics rather than merely drawing content behind system bars.

### Demo 1: authenticated session list

```text
Sign in
→ app loads active sessions
→ tap a session
→ opens a placeholder chat screen for that session
→ pull-to-refresh updates the list
```

Phone layout: `NavigationBar` with Chats, Mail, Notifications, Settings only if those endpoints are ready. Do not add disabled destinations merely to mimic the web UI.

Tablet/wide layout is deferred until phone flow is correct. When added, use Material 3 adaptive navigation patterns rather than a copied web sidebar.

### Demo 2: cached session roster

```text
Open app while connected
→ session list loads
→ close network
→ reopen app
→ cached list is visible and clearly marked stale
→ reconnect refreshes it
```

Use Room for safe metadata cache. The cache is a convenience, not authorization proof: clear it on sign out and do not display it to a different signed-in user.

### Demo 3: read-only canonical chat timeline

```text
Open session
→ history/timeline renders
→ send a web message while Android screen is open
→ Android receives live SSE event
→ background and foreground transcript remain ordered once
```

This proves Android's SSE client against Gateway sequencing before adding message submission.

### Demo 4: send a message and see one streamed answer

```text
Type message
→ press Send
→ optimistic pending user bubble appears
→ Gateway accepts message
→ canonical user event reconciles pending bubble
→ assistant stream appears
→ reload/reconnect shows one final transcript
```

Use an idempotency key generated once per submission. The Android app must handle both orderings:

```text
SSE user event before HTTP response
HTTP response before SSE user event
```

The UI never shows two user bubbles.

### Demo 5: drafts and connection recovery

```text
Type a draft in Session A
→ open Session B
→ return to Session A
→ draft remains

Lose network during response
→ show Reconnecting
→ reconnect from last sequence
→ no duplicate text
```

Persist text drafts locally per authenticated user and session. Do not persist unaccepted attachments across process death in the first release.

### Demo 6: truthful run cancellation

```text
Send a long request
→ stop button shows while active
→ tap Stop
→ UI shows Stopping
→ Gateway/runtime confirms terminal cancellation
→ UI shows Stopped
```

Do not make Android cancellation “look done” before the Gateway emits a terminal event.

### Demo 7: approval card

```text
Gateway emits approval_requested
→ Android displays effect summary and Approve / Reject
→ user decides
→ Gateway confirms outcome
→ timeline retains durable status
```

The Android app sends an approval decision; it never performs the email/effect itself.

## Chat UX requirements

### Transcript

- Group user messages, assistant text, activity rows, approval cards, and errors into visibly different row types.
- Use `LazyColumn` with stable item keys based on durable event/message identity.
- Auto-scroll only when the user is already at the bottom. If reading earlier history, show a `New messages` affordance instead.
- Do not render every token as a separate Compose row. Accumulate assistant deltas into a stable run/message row.
- Announce run status and errors accessibly; do not announce each text token through TalkBack.

### Composer

- Multi-line text field.
- Send button enabled only for non-blank text and valid authenticated/session state.
- Stop replaces or sits beside Send only while the Gateway reports an abortable active run.
- Preserve local text on failed command submission.
- Support Android IME send action plus newline behavior deliberately; test hardware keyboard behavior.

### Connection states

| State | User-facing text | Behavior |
| --- | --- | --- |
| connected | no persistent banner | live SSE active while screen visible |
| reconnecting | `Reconnecting…` | retain transcript/draft; exponential bounded retry |
| offline | `Offline — showing saved activity` | show cached data; commands fail clearly or queue only if explicitly designed |
| unauthorized | `Sign in again` | close SSE, clear sensitive local state after sign out |
| history failed | `Could not load conversation` + Retry | do not display an empty transcript as though it were valid |

## SSE lifecycle on Android

An Android SSE connection is a foreground screen resource, not a permanent background service.

```text
chat screen enters foreground
→ repository opens SSE using last durable cursor
→ events append to Room transactionally
→ Room flow updates ViewModel/UI

chat screen leaves foreground
→ close SSE after a short, deliberate lifecycle boundary
→ retain last sequence

chat screen returns
→ reconnect using cursor
```

Do not use WorkManager to keep an SSE connection alive. WorkManager is for bounded, deferrable work. A later notification architecture can use Firebase Cloud Messaging or another Gateway delivery mechanism to alert the user while the app is backgrounded; it is a separate product/infra decision.

### Reconnection rules

- Use bounded exponential backoff with jitter for transient failures.
- Stop retrying on authentication/authorization failures until user action refreshes credentials.
- Persist the cursor only after the associated event transaction commits to Room.
- Deduplicate by `(timelineGeneration, sequence)`, not text matching.
- If an event arrives with an unexpected gap, request/rebuild history from the last known cursor.
- Never replay a command automatically merely because an SSE connection failed.

## Local storage policy

| Data | Store | Retention |
| --- | --- | --- |
| Device auth token | Keystore-backed encrypted storage | until sign out/revocation |
| Active user identity | DataStore / in-memory | clear on sign out |
| Session roster projection | Room | clear on sign out; bounded cache |
| Timeline projection and SSE cursor | Room | bounded per session; clear on sign out |
| Draft text | DataStore or Room | per user/session; clear after accepted send or delete |
| Attachments not accepted by Gateway | memory only first | discarded after process death |
| Provider credentials | never | Gateway-only |

Do not use shared preferences directly for new state. Use DataStore.

## Visual design

Use Android-native interaction patterns and Material 3 components. Borrow Ahem's visual principles, not its Next.js component code:

- warm neutral surfaces and restrained accent color;
- compact session list with high text contrast;
- clear selected-session state;
- quiet, expandable operational details;
- rounded but not oversized cards;
- motion only for navigation/status feedback and disabled under reduced-motion settings where practical.

Do not port Tailwind classes, Radix UI primitives, DOM focus behavior, or web sidebar geometry into Compose.

## Testing strategy

### Unit tests

Test repositories and ViewModels with fake Gateway clients and test dispatchers:

- session list load/filter/error;
- draft persistence and clearing only after acceptance;
- pending message reconciliation in both HTTP/SSE orderings;
- SSE deduplication and cursor persistence;
- run/cancellation state transitions;
- sign-out cache clearing.

### Network tests

Use Ktor `MockEngine` or a local test server for:

- auth headers present and secrets absent from logs;
- command payloads and idempotency keys;
- malformed SSE event handling;
- reconnect cursor (`Last-Event-ID`/`after`) behavior;
- 401/403 behavior that stops reconnect loops.

### Database tests

Use in-memory Room database tests for:

- event order and deduplication;
- timeline generation reset boundary;
- cache isolation by user;
- transaction: event write and cursor update succeed/fail together.

### Compose UI tests

- sign-in/loading/error states;
- session selection;
- draft restored after navigation;
- send button and pending bubble;
- approval confirmation;
- Stop shows `Stopping…` before terminal outcome;
- TalkBack labels on destructive actions.

### Manual device checklist

- emulator plus at least one physical device;
- portrait and landscape;
- system dark/light mode if supported;
- process recreation while draft exists;
- network flap during stream;
- Gateway restart while app is open;
- sign out and sign in as another account/device;
- large font / TalkBack navigation.

## Implementation discipline for the coding agent

1. Read `AGENTS.md`, `CONTEXT.md`, this guide, `docs/embedded-pi-migration.md`, and `docs/session-ui-ux-spec.md` before changes.
2. Run `android update`, `android info`, `android sdk list`, and `android skills list`; record the Android CLI version and relevant installed SDK/tool versions. If the CLI is unavailable, say so and use the documented Android Studio/Gradle fallback rather than inventing commands.
3. Use `android docs search`/`fetch` to resolve current Android API questions. Install and read the official Android skill matching the current task. Do not use an unrelated skill merely because it is available.
4. Start with Demo 0 or the native-auth contract; do not scaffold all screens at once.
5. At each demo, state the concrete user trace and failure trace before coding.
6. Use `android create` for the initial official project template when available. Inspect generated files before editing; do not immediately replace the generated architecture with a custom framework.
7. Inspect current Android/Gradle/Ktor APIs from primary docs and installed artifacts. Do not use stale snippets or guessed APIs. Confirm that all app dependencies are stable.
8. Prefer Android/Jetpack/Kotlin standard libraries over unneeded third-party dependencies.
9. Keep Android-specific work under `android/`; do not rewrite the web client.
10. Any required Gateway contract change must be client-neutral and separately tested in the existing Node test suite.
11. For each slice, run the applicable Gradle unit, lint, and connected/Compose UI tests; use `android run` to deploy it; inspect it with `android layout` and `android screen capture` where supported; and add/update a deterministic Journey for the visible flow when appropriate.
12. When Gateway code changes, also run the existing Lali typecheck, tests, and web build so the Android client does not regress web behavior.
13. Use Android Studio for final Compose preview inspection, accessibility, debugging, and performance profiling. Passing an agent-run build alone is not production validation.
14. Report commands, tool versions, installed skills, screenshots/Journeys used, tests, and deliberately deferred work.
15. Do not commit unless explicitly requested.

## First implementation ticket

**Title:** Establish native Android authentication contract and prove an authenticated app shell

**Demo:**

```text
Android app opens
→ user signs in through Gateway-owned browser flow
→ returns to the app
→ authenticated GET /api/me succeeds
→ Sign out removes local credential/cache
```

**Why first:** Without a safe native identity contract, every session/chat screen either bypasses security or builds on a browser-cookie assumption that will have to be removed.

**Not included:** session list, Room cache, SSE, chat, notifications, effects, or embedded Pi migration.
