import { Type } from "@earendil-works/pi-ai";
import { defineTool, defineExtension, section } from "@earendil-works/pi-durable";
import { saveTodo, clearTodos, getUserIdForConversation } from "./data.ts";
import { db } from "../db/index.ts";
import { todos } from "../db/schema.ts";
import { sql } from "drizzle-orm";

export const saveTodoTool = defineTool({
  name: "save_todo",
  description: "Save a new task or reminder for the user.",
  parameters: Type.Object({ task: Type.String() }),
  replay: "safe", // It's safe to rerun this tool after a crash
  execute: async (args, api) => {
    const userId = await getUserIdForConversation(String(api.conversationId));
    await saveTodo(String(api.taskId), userId, args.task);
    api.output(`Saved TODO: ${args.task}\n`);
    return { content: [{ type: "text", text: `Success: Saved "${args.task}"` }] };
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
    const { Resend } = await import('resend');
    const resend = new Resend(process.env.RESEND_API_KEY);
    
    // We use the api.taskId as our Idempotency Key!
    const { data, error } = await resend.emails.send({
      from: 'Lali <onboarding@resend.dev>',
      to: process.env.MY_EMAIL_ADDRESS || 'delivered@resend.dev', 
      subject: 'Your Lali Morning Digest',
      text: args.body,
      headers: { 'Idempotency-Key': String(api.taskId) }
    });

    if (error) throw new Error(error.message);
    api.output(`Sent email ID: ${data?.id}\n`);
    return { content: [{ type: "text", text: `Email sent successfully! ID: ${data?.id}` }] };
  }
});

// We bundle the tools and the prompt into an Extension
export const LaliExtension = defineExtension({
  name: "lali",
  sections: [
    section("preamble", () => "You are Lali, an autonomous personal assistant. You can manage the user's todo list and send emails.", { tag: false }),
    section("world_state", async (input) => {
      // Inject the live database state into the system prompt!
      const userId = await getUserIdForConversation(String(input.conversationId));
      const currentTodos = await db.select().from(todos).where(sql`${todos.status} = 'pending' AND ${todos.userId} = ${userId}`);
      return `Current Todos:\n${JSON.stringify(currentTodos, null, 2)}`;
    })
  ],
  tools: [saveTodoTool, clearTodosTool, sendDigestEmailTool]
});
