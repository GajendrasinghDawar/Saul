import { Type } from "@earendil-works/pi-ai";
import {
  defineTool,
  defineExtension,
  section,
  hook,
  ToolTask,
} from "@earendil-works/pi-durable";
import { saveTodo, clearTodos, getUserIdForConversation } from "./data.ts";
import { db } from "../db/index.ts";
import { todos, approvals } from "../db/schema.ts";
import { sql } from "drizzle-orm";
import {
  SYSTEM_PROMPT,
  DEFAULT_EMAIL_FROM,
  DEFAULT_EMAIL_SUBJECT,
} from "./constants.ts";

export const saveTodoTool = defineTool({
  name: "save_todo",
  description: "Save a new task or reminder for the user.",
  parameters: Type.Object({ task: Type.String() }),
  // replay: "safe" means it is safe to rerun this tool after a crash mid-flight
  // because saving the exact same todo twice might be acceptable or idempotent.
  replay: "safe",
  execute: async (args, api) => {
    const userId = await getUserIdForConversation(String(api.conversationId));
    await saveTodo(String(api.taskId), userId, args.task);
    api.output(`Saved TODO: ${args.task}\n`);
    return {
      content: [{ type: "text", text: `Success: Saved "${args.task}"` }],
    };
  },
});

export const clearTodosTool = defineTool({
  name: "clear_todos",
  description: "Clear all pending todos from the database.",
  parameters: Type.Object({}),
  replay: "safe",
  execute: async (args, api) => {
    const userId = await getUserIdForConversation(String(api.conversationId));
    await clearTodos(userId);
    api.output(`Cleared all pending todos\n`);
    return { content: [{ type: "text", text: "Success: Cleared all todos." }] };
  },
});

export const sendDigestEmailTool = defineTool({
  name: "send_digest_email",
  description: "Send an email summary of the user's pending tasks.",
  parameters: Type.Object({ body: Type.String() }),
  // replay: "none", meaning it will NOT rerun if it crashes mid-flight. Safe from double-sending!
  execute: async (args, api) => {
    api.output(`Sending email...\n`);
    const { Resend } = await import("resend");
    const resend = new Resend(process.env.RESEND_API_KEY);

    // We use the api.taskId as our Idempotency Key!
    const { data, error } = await resend.emails.send({
      from: DEFAULT_EMAIL_FROM,
      to: process.env.MY_EMAIL_ADDRESS || "delivered@resend.dev",
      subject: DEFAULT_EMAIL_SUBJECT,
      text: args.body,
      headers: { "Idempotency-Key": String(api.taskId) },
    });

    if (error) throw new Error(error.message);
    api.output(`Sent email ID: ${data?.id}\n`);
    return {
      content: [
        { type: "text", text: `Email sent successfully! ID: ${data?.id}` },
      ],
    };
  },
});

// We bundle the tools and the prompt into an Extension
export const LaliExtension = defineExtension({
  name: "lali",
  sections: [
    section("preamble", () => SYSTEM_PROMPT, { tag: false }),
    section("world_state", async (input) => {
      // Inject the live database state into the system prompt!
      // This allows the agent to always have the latest context without querying.
      const userId = await getUserIdForConversation(
        String(input.conversationId),
      );
      const currentTodos = await db
        .select()
        .from(todos)
        .where(
          sql`${todos.status} = 'pending' AND ${todos.userId} = ${userId}`,
        );
      return `Current Todos:\n${JSON.stringify(currentTodos, null, 2)}`;
    }),
  ],
  tools: [saveTodoTool, clearTodosTool, sendDigestEmailTool],
  hooks: [
    hook(ToolTask, {
      // beforeTool intercepts the tool execution. It's useful for injecting approval flows.
      beforeTool: async (call, api, ctx) => {
        if (call.name === "clear_todos") {
          const userId = await getUserIdForConversation(
            String(api.conversationId),
          );

          const recentApprovals = await db
            .select()
            .from(approvals)
            .where(
              sql`${approvals.userId} = ${userId} AND ${approvals.action} = 'clear_todos'`,
            )
            .orderBy(sql`${approvals.id} DESC`) // Just grab the latest
            .limit(1);

          const latest = recentApprovals[0];

          // If there is no approval, or the last one was rejected, we need a new approval.
          if (
            !latest ||
            latest.status === "pending" ||
            latest.status === "rejected"
          ) {
            // If there's a pending one already, return that ID, else create a new one
            let proposalId =
              latest?.status === "pending" ? latest.id : crypto.randomUUID();

            if (!latest || latest.status === "rejected") {
              await db.insert(approvals).values({
                id: proposalId,
                userId,
                action: "clear_todos",
                detail: "Clear all pending todos",
                status: "pending",
              });
            }

            // Returning a block string halts the tool execution and sends this message back to the LLM/UI.
            return {
              block: `[APPROVAL REQUIRED] Proposal ID: ${proposalId}. Please wait for the user to approve this action via the UI.`,
            };
          }

          // If it's approved, we let it run and consume the approval so it cannot be reused.
          await db
            .update(approvals)
            .set({ status: "consumed" })
            .where(sql`${approvals.id} = ${latest.id}`);
        }

        return {}; // Let other tools pass normally
      },
    }),
  ],
});
