import { Router } from "express";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { AppDependencies } from "../app.ts";
import { getUserConversationIds } from "../agent/data.ts";

export function createTasksRouter({ harness }: AppDependencies) {
  const router = Router();

  router.get("/", async (req, res) => {
    const userId = res.locals.userId;
    const userConvIds = await getUserConversationIds(userId);

    const result = await harness.commit(async (tx) => {
      return tx.scanTasks({}, 100, undefined);
    }, BACKGROUND_CONTEXT);
    
    const userTasks = result.items.filter(t => userConvIds.includes(String(t.conversationId)));
    res.json({ tasks: userTasks });
  });

  return router;
}
