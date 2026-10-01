# Lali Template - Agent Handoff Document

## Project Overview

The user is building **Lali**, a sovereign, cloud-free personal assistant agent based on concepts from the "Background Agents" course, but heavily customized for a local/VPS single-file deployment style.

**Stack:**

- **Backend:** Node.js v25.7 (Native ESM, no `tsx`), Express.
- **Database:** Turso (LibSQL local file), Drizzle ORM.
- **Agent Engine:** Inngest (Durable execution queue).
- **AI:** Vercel AI SDK (Azure OpenAI).
- **Frontend:** React + Vite + Tailwind CSS v4 + Lucide React (located in `web/`).

## Accomplished in this Session

1.  **React Dashboard Setup:** Replaced a static HTML dashboard with a full Vite + React SPA. Configured Tailwind CSS v4 and set up API proxies to the Express backend.
2.  **Database Expansion:** Added `runs` and `agent_events` tables to SQLite to track the agent's lifecycle and internal LLM thoughts, mirroring the course's `timeline` concept.
3.  **Event-Driven Chat:** Created a `POST /api/messages` endpoint that fires an Inngest event (`lali/message.received`).
4.  **Autonomous LLM Loop:** Upgraded the `handleMessage` Inngest function from a simple keyword matcher to a full `while(!isComplete)` agentic loop. The agent now uses `brain.ts` to autonomously decide whether to use the `save_todo` or `reply_to_user` tools based on the user's incoming chat message.

## Current State & Execution

- **Running the stack:** The entire stack is launched via `npm run dev` in the root `lali-template` folder (uses `concurrently` to run the Express backend, Inngest dev server, and Vite frontend simultaneously).
- **Environment:** Relies on `.env` for `AZURE_OPENAI_API_KEY`, `RESEND_API_KEY`, etc. (Keys are redacted and secure).

## Next Session Focus: `docs/`

The user explicitly requested that the next session focus on **`docs/`**.
The next agent should prioritize:

- Documenting the system architecture (how Express, Inngest, and React communicate).
- Creating a robust `README.md` or a `docs/` directory.
- Explaining the agentic loop (the `chooseAction` brain, policy routing, and tool execution).
- Documenting how to add new tools to Lali.

## Artifact References

Please refer to the existing project artifacts in the workspace brain for context on the pivot away from the original course repository:

- `code-reviewer-pivot-plan.md`
- `.agents/agents/lesson-builder/agent.md`

## Suggested Skills for Next Agent

- `writing-for-agents` - To ensure high-quality documentation generation for the `docs/` directory.
- `domain-modeling` - To help formalize the concepts of Lali's sovereign architecture in the documentation.
