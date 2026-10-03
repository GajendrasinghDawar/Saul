import { Router } from "express";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { AppDependencies } from "../app.ts";
import { getUserConversationIds } from "../agent/data.ts";

export function createConversationsRouter({ harness }: AppDependencies) {
  const router = Router();

  router.get("/", async (req, res) => {
    const userId = res.locals.userId;
    const userConvIds = await getUserConversationIds(userId);

    const result = await harness.commit(async (tx) => {
      return tx.scanConversations({}, 100, undefined);
    }, BACKGROUND_CONTEXT);
    
    const userConversations = result.items.filter(c => userConvIds.includes(String(c.id)));
    res.json({ conversations: userConversations });
  });

  return router;
}
