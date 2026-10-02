import { saveTodo, clearTodos, recordToolAction } from "./data.ts";

// Define what a Tool function looks like
export type ToolExecutor = (runId: string, detail: string) => Promise<void>;

// The Tool Registry: Add new tools here without touching the main execution logic!
export const toolRegistry: Record<string, ToolExecutor> = {
  
  save_todo: async (runId, detail) => {
    await saveTodo(detail || "Unknown task");
    await recordToolAction(runId, 'save_todo', `Saved TODO: ${detail}`);
  },

  reply_to_user: async (runId, detail) => {
    await recordToolAction(runId, 'reply_to_user', `Replied: ${detail}`);
  },

  read_todos: async (runId) => {
    await recordToolAction(runId, 'read_todos', 'Loaded world state');
  },

  clear_todos: async (runId) => {
    await clearTodos();
    await recordToolAction(runId, 'clear_todos', 'Cleared pending todos');
  },

  send_digest_email: async (runId, detail) => {
    const { Resend } = await import('resend');
    const resend = new Resend(process.env.RESEND_API_KEY);
    
    const { data, error } = await resend.emails.send({
      from: 'Lali <onboarding@resend.dev>',
      to: process.env.MY_EMAIL_ADDRESS || 'delivered@resend.dev', 
      subject: 'Your Lali Morning Digest',
      html: `<p>${detail?.replace(/\n/g, '<br>')}</p>`,
    });

    if (error) throw new Error(error.message);
    await recordToolAction(runId, 'send_digest_email', `Sent email ID: ${data?.id}`);
  }

};
