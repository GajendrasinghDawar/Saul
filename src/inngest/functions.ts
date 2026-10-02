import { inngest } from "./client.ts";
import { chooseAction } from "../agent/brain.ts";
import { actionPolicy } from "../agent/policy.ts";
import {
  setRun,
  logAgentActivity,
  agentState,
  recordDecision,
  proposeAction,
} from "../agent/data.ts";
import { executeAction } from "../agent/execute.ts";
import crypto from "crypto";

export const dailyMorningDigest = inngest.createFunction(
  {
    id: "daily-morning-digest",
    name: "Daily Morning Digest",
    triggers: [{ cron: "* * * * *" }],
  },
  async ({ step }: any) => {
    let isComplete = false;
    let iteration = 0;
    const runId = crypto.randomUUID();

    await step.run("Init Run", async () => {
      await setRun(runId, "running");
      await logAgentActivity(runId, "log", "Woke up for daily digest");
    });

    while (!isComplete && iteration < 5) {
      iteration++;

      // 1. OBSERVE
      const state = await step.run(`Observe State ${iteration}`, async () => {
        return await agentState(runId);
      });

      // 2. THINK
      const decision = (await step.run(
        `Decide Action ${iteration}`,
        async () => {
          const result = await chooseAction(state);
          await recordDecision(runId, result.action, result.reason);
          return result;
        },
      )) as any;

      const policy = actionPolicy[decision.action as keyof typeof actionPolicy];

      // 3. ACT
      if (policy === "read") {
        await step.run(`Execute ${decision.action} ${iteration}`, async () => {
          await executeAction(runId, decision.action, decision.detail);
        });
      } else if (policy === "approval") {
        const proposalId = await step.run(
          `Propose Action ${iteration}`,
          async () => {
            return await proposeAction(
              runId,
              decision.action,
              decision.detail || "No details",
            );
          },
        );

        const approval = await step.waitForEvent("Wait for Human", {
          event: "agent/approval.decided",
          match: "data.proposalId",
          timeout: "24h",
        });

        if (approval && approval.data.approved) {
          await step.run(`Execute Approved Action ${iteration}`, async () => {
            await executeAction(runId, decision.action, decision.detail);
          });
        } else {
          await step.run(`Handle Rejection ${iteration}`, async () => {
            await logAgentActivity(
              runId,
              "human",
              `Human rejected: ${decision.action}`,
            );
          });
        }
      } else if (policy === "terminal") {
        isComplete = true;
      }
    }

    await step.run("Complete Run", async () => {
      await setRun(runId, "completed");
    });

    return { status: "success", loops: iteration };
  },
);

// Event-Driven Agent

export const handleMessage = inngest.createFunction(
  {
    id: "handle-message",
    name: "Handle Incoming Message",
    triggers: [{ event: "lali/message.received" }],
  },
  async ({ event, step }: any) => {
    const runId = crypto.randomUUID();
    const userMessage = event.data.message;

    await step.run("Init Run", async () => {
      await setRun(runId, "running");
      await logAgentActivity(
        runId,
        "log",
        `Received message: "${userMessage}"`,
      );
    });

    let isComplete = false;
    let iteration = 0;

    while (!isComplete && iteration < 5) {
      iteration++;

      // 1. OBSERVE
      const state = await step.run(`Observe State ${iteration}`, async () => {
        return await agentState(runId, userMessage);
      });

      // 2. THINK
      const decision = (await step.run(
        `Think (Step ${iteration})`,
        async () => {
          const result = await chooseAction(state);
          await recordDecision(runId, result.action, result.reason);
          return result;
        },
      )) as any;

      const policy = actionPolicy[decision.action as keyof typeof actionPolicy];

      // 3. ACT
      if (policy === "write") {
        await step.run(`Execute ${decision.action} ${iteration}`, async () => {
          await executeAction(runId, decision.action, decision.detail);
        });
      } else if (policy === "terminal") {
        isComplete = true;
      }
    }

    await step.run("Complete Run", async () => {
      await setRun(runId, "completed");
    });

    return { status: "success", loops: iteration };
  },
);
