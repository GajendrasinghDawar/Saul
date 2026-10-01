import { inngest } from "./client.ts";
import { db } from "../db/index.ts";
import * as schema from "../db/schema.ts";
import { eq } from "drizzle-orm";
import { chooseAction } from "../agent/brain.ts";
import { actionPolicy } from "../agent/policy.ts";
import crypto from "crypto";

export const dailyMorningDigest = inngest.createFunction(
  { id: "daily-morning-digest", name: "Daily Morning Digest", triggers: [{ cron: "* * * * *" }] },
  async ({ step }: any) => {
    let isComplete = false;
    let iteration = 0;
    const runId = crypto.randomUUID();

    await step.run("Init Run", async () => {
      await db.insert(schema.runs).values({
        id: runId,
        status: 'running'
      });
    });
    
    // We start out with no knowledge of the world
    let state: any = { status: 'just_woke_up', pendingTodos: null };

    while (!isComplete && iteration < 5) {
      iteration++;

      // 1. Decide (Ask LLM Brain what to do based on current state)
      const decision = await step.run("Decide Action", async () => {
        const result = await chooseAction(state);
        await db.insert(schema.agentEvents).values({
          id: crypto.randomUUID(),
          runId,
          type: 'decision',
          message: `Agent decided to: ${result.action}`
        });
        return result;
      }) as any; // Cast to any to bypass inference failures from Inngest types

      const policy = actionPolicy[decision.action as keyof typeof actionPolicy];

      // 2. Act based on Policy
      if (policy === 'read') {
        if (decision.action === 'read_todos') {
          const pendingTodos = await step.run("Fetch pending schema.todos", async () => {
            return await db.select().from(schema.todos).where(eq(schema.todos.status, 'pending'));
          });
          state.pendingTodos = pendingTodos;
          state.status = 'todos_read';
        }
      } 
      else if (policy === 'approval') {
        // Pausing for human approval!
        const proposalId = crypto.randomUUID();
        
        await step.run("Save Proposal to DB", async () => {
          await db.insert(schema.approvals).values({
            id: proposalId,
            action: decision.action,
            detail: decision.detail || "No details provided"
          });
          console.log(`\n⏳ WAITING FOR APPROVAL: ${decision.action}`);
          console.log(`💬 Hit this endpoint to approve it: POST http://localhost:3000/approve/${proposalId}`);
        });

        // The magic: Inngest pauses the function execution entirely until the event is received
        const approval = await step.waitForEvent("Wait for Human", {
          event: "agent/approval.decided",
          match: "data.proposalId",
          timeout: "24h"
        });

        if (approval && approval.data.approved) {
          await step.run("Execute Approved Action", async () => {
            if (decision.action === 'send_digest_email') {
              console.log("===============================");
              console.log("📧 SENDING REAL EMAIL VIA RESEND...");
              
              const { Resend } = await import('resend');
              const resend = new Resend(process.env.RESEND_API_KEY);
              
              const { data, error } = await resend.emails.send({
                from: 'Lali <onboarding@resend.dev>', // Resend's testing email
                to: process.env.MY_EMAIL_ADDRESS || 'delivered@resend.dev', 
                subject: 'Your Lali Morning Digest',
                html: `<p>${decision.detail?.replace(/\n/g, '<br>')}</p>`,
              });

              if (error) {
                console.error("❌ Resend failed:", error);
                throw new Error(error.message); // Inngest will automatically retry if this fails!
              }
              
              console.log("✅ Email sent successfully! ID:", data?.id);
              console.log("===============================");
            } else if (decision.action === 'clear_todos') {
              console.log("🧹 CLEARING schema.todos...");
              // await db.update(schema.todos).set({ status: 'completed' }).where(eq(schema.todos.status, 'pending'));
            }
          });
          state.status = 'action_executed';
        } else {
          await step.run("Handle Rejection", async () => {
            console.log(`❌ Human rejected: ${decision.action}`);
          });
          state.status = 'action_rejected';
        }
      } 
      else if (policy === 'terminal') {
        isComplete = true;
      }
    }

    return { status: "success", loops: iteration };
  }
);

// ------------------------------------------------------------------
// 2. NEW: Event-Driven Agent (Wakes up when you message it)
// ------------------------------------------------------------------
export const handleMessage = inngest.createFunction(
  { id: "handle-message", name: "Handle Incoming Message", triggers: [{ event: "lali/message.received" }] },
  async ({ event, step }: any) => {
    const runId = crypto.randomUUID();
    const userMessage = event.data.message;

    await step.run("Init Run", async () => {
      await db.insert(schema.runs).values({ id: runId, status: 'running' });
      await db.insert(schema.agentEvents).values({
        id: crypto.randomUUID(), runId, type: 'log',
        message: `Received message: "${userMessage}"`
      });
    });

    let state: any = { incomingMessage: userMessage };
    let isComplete = false;
    let iteration = 0;

    while (!isComplete && iteration < 5) {
      iteration++;

      // 1. LLM Decides Action
      const decision = await step.run(`Think (Step ${iteration})`, async () => {
        const result = await chooseAction(state);
        await db.insert(schema.agentEvents).values({
          id: crypto.randomUUID(), runId, type: 'decision',
          message: `Decision: ${result.action} - ${result.reason}`
        });
        return result;
      }) as any;

      const policy = actionPolicy[decision.action as keyof typeof actionPolicy];

      if (policy === 'write') {
        await step.run(`Execute ${decision.action}`, async () => {
          if (decision.action === 'save_todo') {
            await db.insert(schema.todos).values({
              id: crypto.randomUUID(),
              title: decision.detail || "Unknown task",
              status: 'pending'
            });
            await db.insert(schema.agentEvents).values({
              id: crypto.randomUUID(), runId, type: 'tool',
              message: `Saved TODO: ${decision.detail}`
            });
            state.saved = true;
          } else if (decision.action === 'reply_to_user') {
            await db.insert(schema.agentEvents).values({
              id: crypto.randomUUID(), runId, type: 'tool',
              message: `Replied: ${decision.detail}`
            });
            state.replied = true;
          }
        });
      } else if (policy === 'terminal') {
        isComplete = true;
      }
    }

    await step.run("Complete Run", async () => {
      await db.update(schema.runs).set({ status: 'completed' }).where(eq(schema.runs.id, runId));
    });
    
    return { status: "success", loops: iteration };
  }
);
