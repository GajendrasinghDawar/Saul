import express from "express";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { doubleCsrf } from "csrf-csrf";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { builtinModels } from "@earendil-works/pi-ai/providers/all";
import { Harness, createRegistry, configure } from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { LaliExtension } from "./agent/tools.ts";
import { SubagentExtension } from "./agent/subagents.ts";
import { ReminderExtension } from "./agent/reminders.ts";
import { auth, checkAuthHealth, checkDbHealth } from "./auth/auth.ts";
import { toNodeHandler } from "better-auth/node";
import dotenv from "dotenv";
dotenv.config({ override: true });

const app = express();
const port = 3000;

// Prevent random uncaught network errors from crashing the server
process.on('uncaughtException', (err) => {
  console.error("Uncaught Exception:", err);
});
process.on('unhandledRejection', (reason, promise) => {
  console.error("Unhandled Rejection at:", promise, "reason:", reason);
});

// Security middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'"],
    },
  },
}));
app.use(express.json({ limit: "10kb" }));
app.use(cookieParser(process.env.COOKIE_SECRET || "lali-secret"));

// Better Auth handler — must be before CSRF
app.use("/api/auth", toNodeHandler(auth));

// CSRF protection
// @ts-ignore
const { doubleCsrfProtection, generateCsrfToken } = doubleCsrf({
  getSecret: () => process.env.CSRF_SECRET || "csrf-secret",
  getSessionIdentifier: (req: express.Request) => {
    return (req as any).cookies?.["better-auth.session_token"] || "unknown";
  },
  cookieName: "x-csrf-token",
  cookieOptions: {
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
  },
});

const apiLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10000 });

// Health check (no auth needed)
app.get("/health", (_req, res) => {
  const authH = checkAuthHealth();
  if (authH.status !== "ok") return res.status(503).json(authH);
  const dbH = checkDbHealth();
  if (dbH.status !== "ok") return res.status(503).json(dbH);
  res.json({ status: "ok" });
});

// CSRF token endpoint (no auth needed)
app.get("/csrf-token", (req, res) => {
  res.json({ csrfToken: generateCsrfToken(req, res) });
});

// Auth middleware — protects all remaining API routes
app.use(async (req, res, next) => {
  if (req.path === "/" || req.path === "/health" || req.path === "/csrf-token") return next();
  if (req.path.startsWith("/api/auth")) return next();

  try {
    const session = await auth.api.getSession({ headers: new Headers(req.headers as Record<string, string>) });
    if (!session) {
      return res.status(401).json({ error: "ERR_UNAUTH", message: "Authentication required" });
    }
    res.locals.userId = session.user.id;
    next();
  } catch {
    return res.status(500).json({ error: "ERR_AUTH", message: "Auth check failed" });
  }
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

let harness: Harness;

async function startServer() {
  const storage = await openNodeSqliteStorage("./lali-durable.sqlite");
  harness = await Harness.open(storage, { models: models as any, registry }, BACKGROUND_CONTEXT);
  console.log("🚀 Pi Durable Harness Booted");

  app.listen(port, () => {
    console.log(`🚀 Lali Server running at http://localhost:${port}`);
  });
}

startServer();

// ---------------------------------------------------------
// API ROUTES (all protected by auth middleware above)
// ---------------------------------------------------------

// Chat: Submit message to a conversation
app.post("/api/chat", doubleCsrfProtection, apiLimiter, async (req, res) => {
  const { message, conversationId } = req.body;
  
  const conv = conversationId 
    ? await harness.conversation(Number(conversationId) as unknown as import("@earendil-works/pi-durable").ConversationId, BACKGROUND_CONTEXT)
    : await harness.root(BACKGROUND_CONTEXT, {
        agent: { 
          model: { provider: providerName, modelId },
          extensions: { add: [LaliExtension, SubagentExtension, ReminderExtension] }
        }
      });
  
  if (!conv) return res.status(404).send("Not found");
  
  const submission = await conv.submit({ type: "input", content: message }, BACKGROUND_CONTEXT);
  const settled = await submission.wait(BACKGROUND_CONTEXT);
  
  res.json({ success: true, result: settled });
});

// List conversations
app.get("/api/conversations", async (_req, res) => {
  const result = await harness.commit(async (tx) => {
    return tx.scanConversations({}, 100, undefined);
  }, BACKGROUND_CONTEXT);
  res.json({ conversations: result.items });
});

// List tasks
app.get("/api/tasks", async (_req, res) => {
  const result = await harness.commit(async (tx) => {
    return tx.scanTasks({}, 100, undefined);
  }, BACKGROUND_CONTEXT);
  res.json({ tasks: result.items });
});

// Create new conversation
app.post("/api/new-thread", doubleCsrfProtection, apiLimiter, async (_req, res) => {
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
app.post("/api/fork/:messageId", doubleCsrfProtection, apiLimiter, async (req, res) => {
  const { messageId } = req.params;
  const root = await harness.root(BACKGROUND_CONTEXT);
  
  const thread = await root.fork(
    Number(messageId) as unknown as import("@earendil-works/pi-durable").EntryId, 
    { ownership: { kind: "ownerless" } }, 
    BACKGROUND_CONTEXT
  );
  
  res.json({ success: true, newConversationId: thread.id });
});

// SSE Stream — watch the agent live
app.get("/api/stream", async (req, res) => {
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

// Keep the event loop alive
setInterval(() => {}, 60 * 1000);
