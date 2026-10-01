import express from "express";
import { serve } from "inngest/express";
import { inngest } from "./inngest/client.ts";
import { dailyMorningDigest, handleMessage } from "./inngest/functions.ts";
import { db } from "./db/index.ts";
import * as schema from "./db/schema.ts";
import { eq, sql } from "drizzle-orm";

const app = express();
const port = 3000;

app.use(express.json());

app.use(
  "/api/inngest",
  serve({
    client: inngest,
    functions: [dailyMorningDigest, handleMessage],
  })
);

// API for the Dashboard
app.get("/api/stream", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  const sendUpdates = async () => {
    try {
      const pending = await db.select().from(schema.approvals).where(eq(schema.approvals.status, 'pending'));
      const allRuns = await db.select().from(schema.runs).orderBy(sql`${schema.runs.createdAt} DESC`).limit(20);
      const allEvents = await db.select().from(schema.agentEvents).orderBy(sql`${schema.agentEvents.createdAt} DESC`).limit(50);
      
      res.write(`data: ${JSON.stringify({ pending, allRuns, allEvents })}\n\n`);
    } catch (err) {
      console.error("SSE Error:", err);
    }
  };

  sendUpdates();
  const intervalId = setInterval(sendUpdates, 1500);

  req.on("close", () => {
    clearInterval(intervalId);
  });
});

app.post("/api/messages", async (req, res) => {
  await inngest.send({
    name: "lali/message.received",
    data: { message: req.body.message }
  });
  res.json({ success: true });
});

app.post("/approve/:proposalId", async (req, res) => {
  const { proposalId } = req.params;
  await db.update(schema.approvals).set({ status: 'approved' }).where(eq(schema.approvals.id, proposalId));
  
  await inngest.send({
    name: "agent/approval.decided",
    data: { proposalId, approved: true }
  });
  res.json({ message: "Approved!" });
});

app.post("/reject/:proposalId", async (req, res) => {
  const { proposalId } = req.params;
  await db.update(schema.approvals).set({ status: 'rejected' }).where(eq(schema.approvals.id, proposalId));
  
  await inngest.send({
    name: "agent/approval.decided",
    data: { proposalId, approved: false }
  });
  res.json({ message: "Rejected!" });
});

app.listen(port, () => {
  console.log(`🚀 Lali Dashboard running at http://localhost:${port}`);
  console.log(`🧠 Agent endpoint ready at http://localhost:${port}/api/inngest`);
});
