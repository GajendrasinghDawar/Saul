import { Router } from "express";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { configure } from "@earendil-works/pi-durable";
import { LaliExtension } from "../agent/tools.ts";
import { SubagentExtension } from "../agent/subagents.ts";
import { ReminderExtension } from "../agent/reminders.ts";
import type { AppDependencies } from "../app.ts";

export function createChatRouter({ harness, modelConfig }: AppDependencies, csrf: any, limiter: any) {
  const router = Router();
  const { providerName, modelId } = modelConfig;

  // Chat: Submit message to a conversation
  router.post("/chat", csrf, limiter, async (req, res) => {
    const { message, conversationId, whenBusy } = req.body;
    
    const conv = conversationId 
      ? await harness.conversation(Number(conversationId) as unknown as import("@earendil-works/pi-durable").ConversationId, BACKGROUND_CONTEXT)
      : await harness.root(BACKGROUND_CONTEXT, {
          agent: { 
            model: { provider: providerName, modelId },
            extensions: { add: [LaliExtension, SubagentExtension, ReminderExtension] }
          }
        });
    
    if (!conv) return res.status(404).send("Not found");
    
    const submission = await conv.submit({ type: "input", content: message, whenBusy }, BACKGROUND_CONTEXT);
    const settled = await submission.wait(BACKGROUND_CONTEXT);
    
    res.json({ success: true, result: settled });
  });

  // Create new conversation
  router.post("/new-thread", csrf, limiter, async (_req, res) => {
    const convRecord = await harness.commit(async (tx) => {
      return tx.createConversation({ ownership: { kind: "ownerless" } });
    }, BACKGROUND_CONTEXT);
    
    await harness.commit(async (tx) => {
      await configure(tx, convRecord.id, { 
        model: { provider: providerName, modelId },
        extensions: { add: [LaliExtension, SubagentExtension, ReminderExtension] }
      });
    }, BACKGROUND_CONTEXT);

    res.json({ success: true, conversationId: convRecord.id });
  });

  // Fork conversation from a specific message
  router.post("/fork/:messageId", csrf, limiter, async (req, res) => {
    const { messageId } = req.params;
    const root = await harness.root(BACKGROUND_CONTEXT);
    
    const thread = await root.fork(
      Number(messageId) as unknown as import("@earendil-works/pi-durable").EntryId, 
      { ownership: { kind: "ownerless" } }, 
      BACKGROUND_CONTEXT
    );
    
    res.json({ success: true, newConversationId: thread.id });
  });

  // SSE Stream - watch the agent live
  router.get("/stream", async (req, res) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    const conversationId = req.query.conversationId ? Number(req.query.conversationId) : undefined;
    const conv = conversationId 
      ? await harness.conversation(conversationId as unknown as import("@earendil-works/pi-durable").ConversationId, BACKGROUND_CONTEXT) 
      : await harness.root(BACKGROUND_CONTEXT);
      
    if (!conv) return res.status(404).send("Not found");
    
    const view = await conv.viewState(BACKGROUND_CONTEXT);

    res.write(`data: ${JSON.stringify({ type: 'init', view: view.value })}\n\n`);

    const unsubscribe = view.subscribe((value) => {
      res.write(`data: ${JSON.stringify({ type: 'update', view: value })}\n\n`);
    });

    req.on("close", () => {
      unsubscribe();
    });
  });

  return router;
}
