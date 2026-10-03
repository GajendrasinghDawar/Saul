import { useEffect, useState, useRef } from "react";
import { fetchWithCsrf } from "../../lib/api";

export type Message = {
  role: "user" | "assistant";
  content: string;
  requestId: string;
  idempotencyKey?: string;
  status?: "sending" | "delivered" | "failed";
  activities?: string[];
  effects?: Effect[];
  isComplete?: boolean;
};

export type Effect = {
  id: string;
  summary?: string;
  type?: string;
  payload?: unknown;
  data?: unknown;
  digest?: string;
  status?: "pending" | "approved" | "rejected" | "running" | "executed" | "failed" | "expired" | "interrupted" | "unknown";
};

export type ConnectionStatus = "connecting" | "connected" | "disconnected";

export function useChatSession(sessionId: string) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [isCancelling, setIsCancelling] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>("connecting");

  // Keep a ref to pending messages so we can overlay them on the server state
  const pendingMessagesRef = useRef<Map<string, Message>>(new Map());

  useEffect(() => {
    setConnectionStatus("connecting");
    setMessages([]);
    pendingMessagesRef.current.clear();

    // Map pi-durable entries to our Message format
    const processView = (view: any) => {
      const msgs: Message[] = [];
      let currentAssistantMsg: Message | null = null;
      let lastRequestId: string | null = null;

      for (const entry of (view.entries || [])) {
        if (entry.kind === "pi.user") {
          let text = "";
          if (typeof entry.model[0]?.content === "string") text = entry.model[0].content;
          else if (Array.isArray(entry.model[0]?.content)) text = entry.model[0].content.map((c: any) => c.text).join("");
          
          msgs.push({
            role: "user",
            content: text,
            requestId: String(entry.id),
            status: "delivered"
          });
          currentAssistantMsg = null;
        } else if (entry.kind === "pi.assistant") {
          const parts = entry.model[0]?.content;
          if (typeof parts === "string") {
            if (!currentAssistantMsg) {
              currentAssistantMsg = { role: "assistant", content: "", requestId: String(entry.id), activities: [], effects: [] };
              msgs.push(currentAssistantMsg);
            }
            currentAssistantMsg.content += parts;
          } else if (Array.isArray(parts)) {
            for (const part of parts) {
              if (part.type === "text") {
                if (!currentAssistantMsg) {
                  currentAssistantMsg = { role: "assistant", content: "", requestId: String(entry.id), activities: [], effects: [] };
                  msgs.push(currentAssistantMsg);
                }
                currentAssistantMsg.content += part.text;
              } else if (part.type === "toolCall") {
                if (!currentAssistantMsg) {
                  currentAssistantMsg = { role: "assistant", content: "", requestId: String(entry.id), activities: [], effects: [] };
                  msgs.push(currentAssistantMsg);
                }
                currentAssistantMsg.activities!.push("Using Tool: " + part.name);
              }
            }
          }
          lastRequestId = String(entry.id);
        } else if (entry.kind === "pi.tool-result") {
           if (currentAssistantMsg) {
              const res = entry.model[0];
              let text = "";
              if (Array.isArray(res.content)) text = res.content.find((c: any) => c.type === "text")?.text || "";
              else text = res.content;
              currentAssistantMsg.activities!.push("Result: " + String(text).substring(0, 50) + "...");
           }
        }
      }

      // Check if the last assistant entry is complete (has a stopReason that isn't null)
      const lastEntry = view.entries?.[view.entries.length - 1];
      if (lastEntry?.kind === "pi.assistant" && lastEntry.model?.[0]?.stopReason) {
        if (currentAssistantMsg) currentAssistantMsg.isComplete = true;
        setActiveRunId(null);
      } else if (lastEntry?.kind === "pi.assistant" || lastEntry?.kind === "pi.tool-result" || lastEntry?.kind === "pi.user") {
         setActiveRunId(lastRequestId);
      }

      // Overlay pending messages
      const finalMsgs = [...msgs];
      for (const pm of pendingMessagesRef.current.values()) {
        finalMsgs.push(pm);
      }
      setMessages(finalMsgs);
    };

    const es = new EventSource(`/api/stream?conversationId=${sessionId === "main" ? "" : sessionId}`);
    
    es.onopen = () => setConnectionStatus("connected");
    es.onerror = () => setConnectionStatus("disconnected");

    es.onmessage = (e) => {
      const data = JSON.parse(e.data);
      if (data.type === "init" || data.type === "update") {
        processView(data.view);
      }
    };

    return () => {
      es.close();
    };
  }, [sessionId]);

  const submitMessage = async (text: string, attachmentIds: string[] = []) => {
    if (activeRunId || (!text.trim() && attachmentIds.length === 0)) return;

    const idempotencyKey = crypto.randomUUID();
    const pendingMsg: Message = {
      role: "user",
      content: text,
      requestId: idempotencyKey,
      idempotencyKey,
      status: "sending"
    };

    pendingMessagesRef.current.set(idempotencyKey, pendingMsg);
    setMessages(prev => [...prev, pendingMsg]);

    try {
      const res = await fetchWithCsrf("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          conversationId: sessionId === "main" ? undefined : sessionId, 
          message: text,
          attachmentIds
        })
      });
      
      if (!res.ok) throw new Error("Failed to send message");
      
      // Once successfully delivered, we remove it from pending. 
      // The SSE stream will catch it and render it as part of the official state.
      pendingMessagesRef.current.delete(idempotencyKey);
      
    } catch (e) {
      console.error("Failed to send message", e);
      const m = pendingMessagesRef.current.get(idempotencyKey);
      if (m) {
        m.status = "failed";
        setMessages(prev => [...prev]); // Trigger re-render
      }
    }
  };

  const stop = async () => {
    setIsCancelling(true);
    // TODO: implement interrupt in pi-durable if needed
    setTimeout(() => setIsCancelling(false), 2000);
  };

  return { messages, activeRunId, isCancelling, connectionStatus, submitMessage, stop };
}
