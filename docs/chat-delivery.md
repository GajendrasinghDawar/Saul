# Chat delivery and composer safety

This delivery adapts small Campfire patterns without replacing Pi-Durable.

## What changed

- Enter does not send during character composition. Shift+Enter adds a line.
- The web composer grows and shrinks with its text, up to 120 pixels.
- Copy and Fork remain visible on touch screens. Desktop hover behavior remains.
- Each conversation keeps its own draft, staged files, and uncertain send attempt during navigation.
- A successful send clears only its submitted files and an unedited draft. A late response cannot clear another conversation's draft.
- Web and Android send a `requestId`. A manual retry of the same failed text, ordered attachment IDs, and busy policy uses the same ID. An edited payload or a new send after success gets a new ID.
- Pi-Durable admits one submission per conversation and request ID. A retry can return the original result, even after a server restart. Clients use the returned entry ID to remove an already-delivered optimistic row.
- Fork ownership is checked before branch creation or ownership writes.

There is no automatic resend or offline send queue. Matching message text from another device does not confirm an uncertain HTTP request.

## Approvals

The web card reads its state from `GET /api/tasks/approvals/:id`. It does not trust a saved transcript marker as current permission. If that read fails, decision controls are hidden.

Only the owner can read or decide a proposal. A decision can change `pending` to `approved` or `rejected` once. Later decisions return HTTP 409, and the card reloads the state.

Todo-clear permission is scoped to its conversation. The durable tool task saves the exact approved proposal ID in its memo. The account database consumes that permission and completes the pending todos in one transaction. Replaying that same effect does not complete todos added afterward.

Approving a card records permission; it does not start a new agent turn. Send a follow-up such as “Proceed with the approved clear.” Clearing applies to all pending todos at execution time, as the proposal states. Android approval controls are not part of this delivery.

## Limits

- Retry identities and staged files survive conversation navigation, not a browser reload or Android process/activity recreation. Check the transcript before retrying after either event.
- Web text drafts retain the existing tab-session storage. Android drafts remain in memory for the authenticated session.
- Old unscoped todo-clear approvals cannot authorize the new scoped tool. Request a new proposal; no compatibility cutover is provided.
- This change does not add image previews, referenced replies, history search, an attention inbox, or Stop execution.

## Checks

Run from the repository root:

```powershell
npx tsc --noEmit
node --test server/test/*.test.ts web/test/*.test.ts
npm run build --prefix web

$env:JAVA_HOME = "C:\Users\dawar\.jdks\jbr-17.0.14"
.\android\gradlew.bat -p android testDebugUnitTest lintDebug assembleDebug --console=plain
```

The backend chat test uses temporary SQLite files, an in-memory account database, fixture identities, and a fake model. It checks restart deduplication, concurrent admission, unauthorized forks, approval decisions, and replay-safe todo completion. It does not test real authentication or a paid model.

Manual checks:

1. Enter four lines. Confirm the composer grows. Use a character-composition keyboard and confirm its Enter key does not send.
2. Write a draft and stage a file in chat A. Open chat B. Return to A. Confirm the draft and file remain only in A.
3. Submit in A, then open B before the response finishes. Write in B. Confirm A's response does not clear B.
4. On a phone, find Copy and Fork without hover.
5. For an uncertain delivery, retry the unchanged draft without reloading. Confirm one user entry exists. The Network panel must show the same request ID.
6. Request a todo clear. Approve in one browser and try Reject in another. Only one decision may succeed. Reload the card to see the saved state.
