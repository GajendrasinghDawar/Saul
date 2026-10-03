import express from "express";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { builtinModels } from "@earendil-works/pi-ai/providers/all";
import { Harness, createRegistry, configure } from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { LaliExtension } from "./agent/tools.ts";
import { SubagentExtension } from "./agent/subagents.ts";
import { ReminderExtension } from "./agent/reminders.ts";
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

app.use(express.json());

// 1. Initialize the AI Models
const models = builtinModels();

// Determine the model string based on environment variables
const isAzure = !!process.env.AZURE_OPENAI_MODEL;
const providerName = isAzure ? "azure-openai-responses" : "openai-responses";
const modelId = process.env.AZURE_OPENAI_MODEL || process.env.OPENAI_MODEL || "gpt-4";

// Explicitly register the custom model in case it's not in the catalog
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

// 2. Initialize the Pi Durable Registry & Harness
const registry = createRegistry();
registry.install(LaliExtension);
registry.install(SubagentExtension);
registry.install(ReminderExtension);

let harness: Harness;

async function startServer() {
  const storage = await openNodeSqliteStorage("./lali-durable.sqlite");
  harness = await Harness.open(storage, { models, registry }, BACKGROUND_CONTEXT);
  console.log("🚀 Pi Durable Harness Booted");

  app.listen(port, () => {
    console.log(`🚀 Lali Server running at http://localhost:${port}`);
  });
}

startServer();

// ---------------------------------------------------------
// ROUTES
// ---------------------------------------------------------

// 1. Chat Endpoint (Submit an input to the Root Conversation)
app.post("/api/chat", async (req, res) => {
  const { message, conversationId } = req.body;
  
  // Use the provided conversationId, or fallback to root
  const conv = conversationId 
    ? await harness.conversation(Number(conversationId) as unknown as import("@earendil-works/pi-durable").ConversationId, BACKGROUND_CONTEXT)
    : await harness.root(BACKGROUND_CONTEXT, {
        agent: { 
          model: { provider: providerName, modelId },
          extensions: { add: [LaliExtension, SubagentExtension, ReminderExtension] }
        }
      });
  
  if (!conv) return res.status(404).send("Not found");
  
  // Submit the input and wait for it to process
  const submission = await conv.submit({ type: "input", content: message }, BACKGROUND_CONTEXT);
  const settled = await submission.wait(BACKGROUND_CONTEXT);
  
  res.json({ success: true, result: settled });
});

// 1.5. List Conversations Endpoint
app.get("/api/conversations", async (req, res) => {
  const result = await harness.commit(async (tx) => {
    return tx.scanConversations({}, 100, undefined);
  }, BACKGROUND_CONTEXT);
  res.json({ conversations: result.items });
});

// 1.6. Create New Thread Endpoint
app.post("/api/new-thread", async (req, res) => {
  const convRecord = await harness.commit(async (tx) => {
    return tx.createConversation({ ownership: { kind: "ownerless" } });
  }, BACKGROUND_CONTEXT);
  
  // Set the default agent for this new conversation
  await harness.commit(async (tx) => {
    await configure(tx, convRecord.id, { 
      model: { provider: providerName, modelId },
      extensions: { add: [LaliExtension, SubagentExtension, ReminderExtension] }
    });
  }, BACKGROUND_CONTEXT);

  res.json({ success: true, conversationId: convRecord.id });
});

// 2. Fork Endpoint (Branch off a specific message ID)
app.post("/api/fork/:messageId", async (req, res) => {
  const { messageId } = req.params;
  const root = await harness.root(BACKGROUND_CONTEXT);
  
  // Create a brand new conversation branching from that message
  const thread = await root.fork(
    Number(messageId) as unknown as import("@earendil-works/pi-durable").EntryId, 
    { ownership: { kind: "ownerless" } }, 
    BACKGROUND_CONTEXT
  );
  
  res.json({ success: true, newConversationId: thread.id });
});

// 3. SSE Stream Endpoint (Watch the agent live!)
app.get("/api/stream", async (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  const conversationId = req.query.conversationId ? Number(req.query.conversationId) : undefined;
  const conv = conversationId ? await harness.conversation(conversationId as unknown as import("@earendil-works/pi-durable").ConversationId, BACKGROUND_CONTEXT) : await harness.root(BACKGROUND_CONTEXT);
  if (!conv) return res.status(404).send("Not found");
  
  const view = await conv.viewState(BACKGROUND_CONTEXT);

  // Send the initial state
  res.write(`data: ${JSON.stringify({ type: 'init', view: view.value })}\n\n`);

  // Subscribe to live changes
  const unsubscribe = view.subscribe((value) => {
    res.write(`data: ${JSON.stringify({ type: 'update', view: value })}\n\n`);
  });

  req.on("close", () => {
    unsubscribe();
  });
});


// Keep the event loop alive to prevent mysterious code 0 exits
setInterval(() => {}, 60 * 1000);
