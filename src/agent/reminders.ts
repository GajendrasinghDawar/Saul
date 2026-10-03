import { defineTask, defineTool, defineExtension } from "@earendil-works/pi-durable";
import { Type } from "@earendil-works/pi-ai";

type ReminderInput = { message: string; at: number };
type ReminderState = { phase: "wait" } | { phase: "remind" };

export const ReminderTask = defineTask<ReminderInput, ReminderState, null>({
  name: "lali.reminder",
  version: 1,
  initial: () => ({ phase: "wait" }),
  phases: {
    wait: async (task, runtime, taskContext) => {
      // Sleep until the scheduled time
      await runtime.sleep(task.input.at, taskContext);
      
      // Move to the next phase so we don't sleep again if we crash during submission
      await runtime.commit(() => ({ status: "running", checkpoint: { phase: "remind" } }), taskContext);
    },
    remind: async (task, runtime, taskContext) => {
      const conv = (await runtime.conversation(runtime.conversationId, taskContext))!;
      
      // Inject the reminder directly into the conversation
      await conv.submit(
        { 
          type: "input", 
          content: `[System Reminder] You scheduled a reminder: ${task.input.message}`, 
          whenBusy: "followUp" 
        }, 
        taskContext
      );

      // Send the email reminder
      try {
        const { Resend } = await import('resend');
        const resend = new Resend(process.env.RESEND_API_KEY);
        const { data, error } = await resend.emails.send({
          from: 'Lali <onboarding@resend.dev>',
          to: process.env.MY_EMAIL_ADDRESS || 'delivered@resend.dev', 
          subject: '⏰ Lali Reminder',
          html: `<p>You asked me to remind you:</p><h3>${task.input.message}</h3>`,
          headers: { 'Idempotency-Key': String(task.id) }
        });
        
        if (error) {
          console.error("Resend API Error:", error);
        } else {
          console.log(`Sent reminder email for task ${task.id}`, data);
        }
      } catch (error) {
        console.error("Failed to send reminder email (Exception):", error);
      }

      // Finish the task
      await runtime.commit(() => ({ status: "terminal", outcome: { status: "completed", result: null } }), taskContext);
    }
  },
  abort: (_task, runtime, taskContext) => 
    runtime.commit(() => ({ status: "terminal", outcome: { status: "aborted" } }), taskContext),
});

export const scheduleReminderTool = defineTool({
  name: "schedule_reminder",
  description: "Schedule a reminder to be sent to you in the future. Useful for setting alarms, timers, or reminding yourself to check on something later.",
  parameters: Type.Object({
    message: Type.String({ description: "The message to remind the user of." }),
    delaySeconds: Type.Number({ description: "How many seconds from now to send the reminder." })
  }),
  replay: "unsafe",
  execute: async (args, api, callContext) => {
    const at = Date.now() + (args.delaySeconds * 1000);
    
    await api.commit(async (tx) => {
      await tx.createTask(ReminderTask, { message: args.message, at }, {
        ownership: { kind: "conversation" },
        background: true
      });
    }, callContext);

    return { content: [{ type: "text", text: `Reminder scheduled! I will remind you about "${args.message}" in ${args.delaySeconds} seconds.` }] };
  }
});

export const ReminderExtension = defineExtension({
  name: "reminder-tools",
  tasks: [ReminderTask],
  tools: [scheduleReminderTool]
});
