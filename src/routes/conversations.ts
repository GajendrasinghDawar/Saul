import { Router } from "express";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { AppDependencies } from "../app.ts";

export function createConversationsRouter({ harness }: AppDependencies) {
  const router = Router();

  router.get("/", async (_req, res) => {
    const result = await harness.commit(async (tx) => {
      return tx.scanConversations({}, 100, undefined);
    }, BACKGROUND_CONTEXT);
    res.json({ conversations: result.items });
  });

  return router;
}
