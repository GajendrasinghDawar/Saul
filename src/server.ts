import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { builtinModels } from "@earendil-works/pi-ai/providers/all";
import { Harness, createRegistry } from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { LaliExtension } from "./agent/tools.ts";
import { SubagentExtension } from "./agent/subagents.ts";
import { ReminderExtension } from "./agent/reminders.ts";
import { auth, checkAuthHealth, checkDbHealth } from "./auth/auth.ts";
import { createApp } from "./app.ts";
import dotenv from "dotenv";

dotenv.config({ override: true });

// Prevent random uncaught network errors from crashing the server
process.on('uncaughtException', (err) => {
  console.error("Uncaught Exception:", err);
  process.exit(1);
});
process.on('unhandledRejection', (reason, promise) => {
  console.error("Unhandled Rejection at:", promise, "reason:", reason);
  process.exit(1);
});

// ---------------------------------------------------------
// AI MODEL SETUP
// ---------------------------------------------------------
const models = builtinModels();
const isAzure = !!process.env.AZURE_OPENAI_MODEL;
const providerName = isAzure ? "azure-openai-responses" : "openai-responses";
const modelId = process.env.AZURE_OPENAI_MODEL || process.env.OPENAI_MODEL || "gpt-4";

if (!models.getModel(providerName, modelId)) {
  // @ts-ignore
  models.addModel({
    id: modelId,
    name: "Custom Model",
    api: providerName as any,
    provider: providerName as any,
    baseUrl: isAzure ? (process.env.AZURE_OPENAI_BASE_URL || "") : "",
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128000,
    maxTokens: 4096,
    reasoning: false
  });
}

// ---------------------------------------------------------
// PI DURABLE SETUP
// ---------------------------------------------------------
const registry = createRegistry();
registry.install(LaliExtension);
registry.install(SubagentExtension);
registry.install(ReminderExtension);

async function startServer() {
  const storage = await openNodeSqliteStorage("./lali-durable.sqlite");
  const harness = await Harness.open(storage, { models: models as any, registry }, BACKGROUND_CONTEXT);
  console.log("🚀 Pi Durable Harness Booted");

  const app = createApp({
    harness,
    auth,
    modelConfig: { providerName, modelId }
  });

  // Health check (no auth needed)
  app.get("/health", (_req, res) => {
    const authH = checkAuthHealth();
    if (authH.status !== "ok") return res.status(503).json(authH);
    const dbH = checkDbHealth();
    if (dbH.status !== "ok") return res.status(503).json(dbH);
    res.json({ status: "ok" });
  });

  const port = process.env.PORT || 3000;
  app.listen(port, () => {
    console.log(`🚀 Lali Server running at http://localhost:${port}`);
  });
}

startServer().catch(err => {
  console.error("Failed to start server", err);
  process.exit(1);
});
