# Agent Instructions

Saul is a self-hosted personal AI assistant with web and native Android clients. The Node.js backend runs agents through Pi-Durable. Keep the architecture simple: `server/` owns the API, agent execution, and storage; `web/` and `android/` own their clients. Start with `README.md` for setup and checks.

## Conversational style

- keep answers short and concise.
- No emojis in commits, issues, or PRs or code.
- Technical prose only, be direct
- Use concise, clear, simple language. Define unavoidable jargon before using it.
- Explain non-trivial designs and problems as: problem, concrete example or short trace, then solution. State why the solution is necessary and distinguish it from optional complexity.
- Prefer concrete behavior and small illustrations over abstract summaries, dense terminology, or unexplained lists of changes.
- When the user asks a question, answer it first before making edits or running implementation commands.
- When responding to user feedback or an analysis, explicitly say whether you agree or disagree before saying what you changed.

## Code Quality

- No `any` unless absolutely necessary.
- Check node_modules for external API types; don't guess.
- **No inline imports** (`await import()`, `import("pkg").Type`, dynamic type imports). Top-level imports only.
- Never remove or downgrade code to fix type errors from outdated deps; upgrade the dep instead.
- Use only erasable TypeScript syntax in `server/` (Node strip-only mode): no parameter properties, `enum`, `namespace`/`module`, `import =`, `export =`, or other constructs needing JS emit. Use explicit fields with constructor assignments.
- Do not preserve backward compatibility unless the user asks for it.
- **Use Node.js 24+ built-ins** rather than adding third-party packages for built-in functionality.
  - Use `node:sqlite` instead of `better-sqlite3`.
  - Use `process.loadEnvFile()` instead of `dotenv`.
  - Use `node test.ts` for running TypeScript natively instead of `tsx`, `ts-node`, or compiling.
  - Use the Node Permission Model (`--permission`) to lock down production services instead of external sandbox tooling.
  - Always prefer Node's standard library over adding new dependencies.

## Agent skills

### Issue tracker
Issues are tracked on GitHub using the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels
The default 5-role triage vocabulary is used. See `docs/agents/triage-labels.md`.

### Domain docs
For domain terminology and architecture decision records, see `docs/agents/domain.md`.

## Android Client

- The Android app must be completely identical to the web UI in terms of its design system and color theming.
- Before planning or implementing Android work, read `docs/android-client-implementation-guide.md` and the Android CLI skill.

## Pi-Durable and storage

Before changing agent execution, tasks, approvals, or recovery, read `docs/durable-reliability.md` and the installed `node_modules/@earendil-works/pi-durable/README.md`. For database adapters and transactions, also read `docs/pi-libsql-storage.md`. Pi owns its own schema and execution model; adapt its APIs rather than duplicating them.

Development uses two local databases; production requires two distinct remote libSQL databases and one active backend process. Startup applies checked-in app migrations from `server/drizzle/`. Generate and review migration SQL with schema changes; keep database contents and credentials out of Git.
