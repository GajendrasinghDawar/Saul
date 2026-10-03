import { Router } from "express";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { AppDependencies } from "../app.ts";

export function createTasksRouter({ harness }: AppDependencies) {
  const router = Router();

  router.get("/", async (_req, res) => {
    const result = await harness.commit(async (tx) => {
      return tx.scanTasks({}, 100, undefined);
    }, BACKGROUND_CONTEXT);
    res.json({ tasks: result.items });
  });

  return router;
}
