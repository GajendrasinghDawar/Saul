import { Router } from "express";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { configure } from "@earendil-works/pi-durable";
import { LaliExtension } from "../agent/tools.ts";
import { SubagentExtension } from "../agent/subagents.ts";
import { ReminderExtension } from "../agent/reminders.ts";
import { isConversationOwner } from "../agent/data.ts";
import { db } from "../db/index.ts";
import { userConversations } from "../db/schema.ts";
import type { AppDependencies } from "../app.ts";

export function createChatRouter(
  { harness, modelConfig }: AppDependencies,
  csrf: any,
  limiter: any,
) {
  const router = Router();
  const { providerName, modelId } = modelConfig;

  // Chat: Submit message to a conversation
  router.post("/chat", csrf, limiter, async (req, res) => {
    const { message, conversationId, whenBusy } = req.body;
    const userId = res.locals.userId;

    if (
      conversationId &&
      !(await isConversationOwner(String(conversationId), userId))
    ) {
      return res
        .status(403)
        .json({ error: "Forbidden: Not conversation owner" });
    }

    const conv = conversationId
      ? await harness.conversation(
          Number(
            conversationId,
          ) as unknown as import("@earendil-works/pi-durable").ConversationId,
          BACKGROUND_CONTEXT,
        )
      : await harness.root(BACKGROUND_CONTEXT, {
          agent: {
            model: { provider: providerName, modelId },
            extensions: {
              add: [LaliExtension, SubagentExtension, ReminderExtension],
            },
          },
        });

    if (!conv) return res.status(404).send("Not found");

    if (!conversationId) {
      await db
        .insert(userConversations)
        .values({ conversationId: String(conv.id), userId });
    }

    const submission = await conv.submit(
      { type: "input", content: message, whenBusy },
      BACKGROUND_CONTEXT,
    );
    const settled = await submission.wait(BACKGROUND_CONTEXT);

    res.json({ success: true, result: settled });
  });

  // Create new conversation
  router.post("/new-thread", csrf, limiter, async (_req, res) => {
    const userId = res.locals.userId;
    const convRecord = await harness.commit(async (tx) => {
      return tx.createConversation({ ownership: { kind: "ownerless" } });
    }, BACKGROUND_CONTEXT);

    await harness.commit(async (tx) => {
      await configure(tx, convRecord.id, {
        model: { provider: providerName, modelId },
        extensions: {
          add: [LaliExtension, SubagentExtension, ReminderExtension],
        },
      });
    }, BACKGROUND_CONTEXT);

    await db
      .insert(userConversations)
      .values({ conversationId: String(convRecord.id), userId });

    res.json({ success: true, conversationId: convRecord.id });
  });

  // Fork conversation from a specific message
  router.post("/fork/:messageId", csrf, limiter, async (req, res) => {
    const messageIdNum = Number(
      req.params.messageId,
    ) as unknown as import("@earendil-works/pi-durable").EntryId;
    const userId = res.locals.userId;

    const entry = await harness.commit(async (tx) => {
      return await tx.entry(messageIdNum);
    }, BACKGROUND_CONTEXT);

    if (!entry) return res.status(404).json({ error: "Message not found" });

    if (!(await isConversationOwner(String(entry.conversationId), userId))) {
      return res.status(403).json({ error: "Forbidden" });
    }

    const parentConv = await harness.conversation(
      entry.conversationId,
      BACKGROUND_CONTEXT,
    );
    if (!parentConv)
      return res.status(404).json({ error: "Parent conversation not found" });

    const thread = await parentConv.fork(
      messageIdNum,
      { ownership: { kind: "ownerless" } },
      BACKGROUND_CONTEXT,
    );

    await db
      .insert(userConversations)
      .values({ conversationId: String(thread.id), userId });

    res.json({ success: true, newConversationId: thread.id });
  });

  // SSE Stream - watch the agent live
  router.get("/stream", async (req, res) => {
    const userId = res.locals.userId;
    const conversationId = req.query.conversationId
      ? Number(req.query.conversationId)
      : undefined;

    if (
      conversationId &&
      !(await isConversationOwner(String(conversationId), userId))
    ) {
      return res.status(403).send("Forbidden");
    }

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    const conv = conversationId
      ? await harness.conversation(
          conversationId as unknown as import("@earendil-works/pi-durable").ConversationId,
          BACKGROUND_CONTEXT,
        )
      : await harness.root(BACKGROUND_CONTEXT);

    if (!conv) return res.status(404).send("Not found");

    if (!conversationId) {
      // Root might not have been recorded if they just streamed before chatting. Wait,
      // if they just hit stream on root without conversationId, root's ID is implicit (usually 1 or derived).
      // It's safer to ensure root belongs to them or skip recording here if it's the global root.
    }

    const view = await conv.viewState(BACKGROUND_CONTEXT);

    res.write(
      `data: ${JSON.stringify({ type: "init", view: view.value })}\n\n`,
    );

    const unsubscribe = view.subscribe((value) => {
      res.write(`data: ${JSON.stringify({ type: "update", view: value })}\n\n`);
    });

    req.on("close", () => {
      unsubscribe();
    });
  });

  return router;
}
