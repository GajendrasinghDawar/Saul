import { defineTask, defineTool, defineExtension } from "@earendil-works/pi-durable";
import { Type } from "@earendil-works/pi-ai";

type ReminderInput = { message: string; at: number };
type ReminderState = { phase: "wait" } | { phase: "remind" };

export interface NotificationGateway {
  sendReminder(id: string, message: string): Promise<void>;
}

export const ResendNotificationGateway: NotificationGateway = {
  async sendReminder(id: string, message: string) {
    const { Resend } = await import('resend');
    const resend = new Resend(process.env.RESEND_API_KEY);
    const { data, error } = await resend.emails.send({
      from: 'Lali <onboarding@resend.dev>',
      to: process.env.MY_EMAIL_ADDRESS || 'delivered@resend.dev', 
      subject: '⏰ Lali Reminder',
      text: `You asked me to remind you:\n\n${message}`,
      headers: { 'Idempotency-Key': id }
    });
    
    if (error) {
      throw new Error(`Resend API Error: ${error.message}`);
    }
    console.log(`Sent reminder email for task ${id}`, data);
  }
};

export let NotificationService: NotificationGateway = ResendNotificationGateway;

export function setNotificationService(service: NotificationGateway) {
  NotificationService = service;
}

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
          whenBusy: "followUp",
          requestId: `reminder-${task.id}`
        }, 
        taskContext
      );

      // Send the email reminder
      await NotificationService.sendReminder(String(task.id), task.input.message);

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

export const manageRemindersTool = defineTool({
  name: "manage_reminders",
  description: "List active scheduled reminders.",
  parameters: Type.Object({
    action: Type.Literal("list")
  }),
  replay: "unsafe",
  execute: async (args, api, callContext) => {
    if (args.action === "list") {
      const result = await api.commit(async (tx) => {
        return tx.scanTasks({}, 100, undefined);
      }, callContext);
      
      const reminders = result.items.filter(t => t.kind === "lali.reminder" && t.state.status === "running");
      
      if (reminders.length === 0) return { content: [{ type: "text", text: "No active reminders." }] };
      
      return { 
        content: [{ 
          type: "text", 
          text: `Active reminders:\n${reminders.map(r => {
            const state = r.state as any;
            return `- Task ID: ${r.id} (Phase: ${state.checkpoint?.phase || 'wait'})`;
          }).join('\n')}` 
        }] 
      };
    }
    
    throw new Error("Invalid action.");
  }
});

export const ReminderExtension = defineExtension({
  name: "reminder-tools",
  tasks: [ReminderTask],
  tools: [scheduleReminderTool, manageRemindersTool]
});
