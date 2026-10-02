import { saveTodo, clearTodos, recordToolAction } from "./data.ts";

export async function executeAction(runId: string, action: string, detail: string = ""): Promise<void> {
  try {
    if (action === 'save_todo') {
      await saveTodo(detail || "Unknown task");
      await recordToolAction(runId, action, `Saved TODO: ${detail}`);
    } 
    else if (action === 'reply_to_user') {
      await recordToolAction(runId, action, `Replied: ${detail}`);
    }
    else if (action === 'read_todos') {
      await recordToolAction(runId, action, 'Loaded world state');
    }
    else if (action === 'clear_todos') {
      await clearTodos();
      await recordToolAction(runId, action, 'Cleared pending todos');
    }
    else if (action === 'send_digest_email') {
      const { Resend } = await import('resend');
      const resend = new Resend(process.env.RESEND_API_KEY);
      
      const { data, error } = await resend.emails.send({
        from: 'Lali <onboarding@resend.dev>',
        to: process.env.MY_EMAIL_ADDRESS || 'delivered@resend.dev', 
        subject: 'Your Lali Morning Digest',
        html: `<p>${detail?.replace(/\n/g, '<br>')}</p>`,
      });

      if (error) throw new Error(error.message);
      await recordToolAction(runId, action, `Sent email ID: ${data?.id}`);
    }
    else {
      throw new Error(`Unknown action: ${action}`);
    }
  } catch (error: any) {
    // Lesson 2 pattern: log failures durably so the agent knows the tool crashed
    await recordToolAction(runId, action, `FAILED: ${error.message}`);
    throw error;
  }
}
