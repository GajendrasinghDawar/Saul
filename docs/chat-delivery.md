# Web chat delivery and visible work

These features adapt Campfire patterns without replacing Pi-Durable. This delivery changes the web client and shared server APIs, not Android.

## Composer and replies

- Enter does not send during character composition. Shift+Enter adds a line.
- The slate-and-jade composer grows from 72 to 240 pixels. Touch controls remain visible.
- Each conversation keeps its own text draft, staged files and reply selection during navigation. Text drafts use user-scoped tab-session storage.
- Images have local previews. Picker, paste and drop use the same validation and upload path. Removed previews release their object URLs.
- Reply selects a saved user or assistant message. The server checks ownership and fork visibility, then builds the quote from saved history. Client-provided quote text is not trusted.
- Replies are follow-ups, not steering commands. There is no Stop execution control in this delivery.

## Persistent outbox

The delivery module saves each submitted message in user-scoped local storage before sending it. It retains an immutable payload, uploaded attachment references, target conversation ID and random request ID across reloads. This persistence is hidden from the chat UI: pending state and recovery actions appear on the original message bubble, not in a separate outbox panel.

For example, the server can accept a message but lose its HTTP response. The browser retries that same request ID. Pi-Durable returns the original submission instead of admitting a second turn. The client removes the local row only after it has a receipt and sees its exact entry in the transcript. Matching text from another device is not a receipt.

- Offline messages queue in an already loaded, authenticated app. They send when connectivity returns.
- Web Locks coordinate browser tabs. Short queue writes do not wait for a pending network response.
- Sends stay in order within a conversation. A failed head blocks that conversation, not every conversation.
- Uncertain failures retry with backoff. After eight automatic attempts, the user can retry with the same ID. Permanent request errors require manual action. Authentication failures pause sending until the app authenticates again.
- Removing an unattempted row cancels that local send. Forgetting a failed, attempted row does not cancel server work; the UI warns before doing so.
- The main conversation must resolve to its canonical ID before an offline send. HTTPS or localhost and browser Web Locks are required.

## Search and attention

Search reads only saved visible user and assistant prose from owned conversations, including visible fork ancestors. It excludes tool output, reported thinking and internal attachment/reply markers. Each page scans at most 200 entries in one conversation. Use **Search more history** to continue. Search never runs the model or tools.

Search results link to their original entry. If compaction removed that entry from the live view, the chat shows a saved source excerpt with a Reply action.

The attention inbox collects pending approvals, due reminders, failed tasks and delivered delegated reports. Ordinary completed tools and turns are not results. Open the inbox or use Refresh to read current state. Items remain until their source changes; read/dismiss tracking is not implemented.

## Visible agent work

The transcript shows waiting, reported thinking, tool activity and answer streaming from Pi's live view. Inspect a work row to read available reported text or tool output. These are received events, not a percentage estimate or access to unreported model reasoning. Pulse animation respects reduced-motion preferences. A disconnected stream shows its last received state without a live animation.

## Approvals

The web card reads its state from `GET /api/tasks/approvals/:id`. It does not trust a saved transcript marker as current permission. If that read fails, decision controls are hidden.

Only the owner can read or decide a proposal. A decision can change `pending` to `approved` or `rejected` once. Later decisions return HTTP 409, and the card reloads the state.

Todo-clear permission is scoped to its conversation. The durable tool task saves the exact approved proposal ID in its memo. The account database consumes that permission and completes the pending todos in one transaction. Replaying that same effect does not complete todos added afterward.

Approving a card records permission; it does not start a new agent turn. Send a follow-up such as “Proceed with the approved clear.” Clearing applies to all pending todos at execution time, as the proposal states. Android approval controls are not part of this delivery.

## Limits

- This is not an offline-installable app. A cold page load still needs the server to verify the session and load the application.
- Unsent file bytes and reply selections remain in memory. Upload files while connected before queueing them. A queued send persists uploaded references, not local file bytes.
- Browser storage is not a backup. Clearing it loses drafts and pending retry identities. Queued text is readable by same-origin scripts; use only a trusted browser profile.
- Android retains its previous behavior. Its retry identities do not survive process/activity recreation.
- Old unscoped todo-clear approvals cannot authorize the scoped tool. Request a new proposal.

## Checks

Run from the repository root:

```powershell
npx tsc --noEmit
node --test server/test/*.test.ts web/test/*.test.ts
npm run build --prefix web
```

Backend tests use temporary SQLite files, in-memory account databases, fixture identities and a fake model. They check restart deduplication, concurrent admission, fork/reply ownership, read-only search pagination, approval decisions, attention selection and replay-safe todo completion. Outbox tests check reloads, cross-tab writes, retry ordering, authentication pauses and storage failure. These tests do not verify real authentication, S3 credentials or a paid model.

Manual checks:

1. Start the app with `npm run dev`, sign in and open a chat. Enter several lines. Confirm growth, Shift+Enter and character-composition Enter behavior.
2. Stage an image using the picker, paste or drop. Inspect its preview, then remove it. Switch between two conversations and check their drafts remain separate.
3. Reply to an assistant message. Confirm the quoted source is correct and only the new text becomes message prose.
4. In browser developer tools, set Network to Offline after the chat loads. Send text. Confirm its message bubble says **Waiting for connection…**. Reconnect and confirm one saved message.
5. Simulate a lost chat response after server admission, then reload. Inspect Network and local storage: retries must retain the original request ID and produce one saved entry. Do not create a new send to retry uncertain work.
6. Open the same account in two tabs. Queue messages in both. Check no message disappears and conversation ordering is preserved. Check failed message bubbles offer Retry and Delete without exposing request IDs.
7. Watch an answer with reported thinking and a tool call. Inspect the work rows. Disconnect while streaming; confirm live animation stops and the connection label changes.
8. Search for a distinctive saved phrase. Follow its source link. Confirm no chat POST occurs. Use continuation for older pages and check a source outside the current live view.
9. Open Attention. Check approvals, reminders, failures and delivered reports. Approve in one browser and try Reject in another; only one decision may succeed. A conflict reloads the inbox. A failed refresh must not show stale cards as current.
10. At phone width, check the composer, previews, actions, Search and Attention without horizontal overflow. Enable reduced motion and check the pulse stops.
