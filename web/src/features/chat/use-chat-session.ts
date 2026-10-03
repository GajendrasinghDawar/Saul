import { useEffect, useReducer, useRef } from "react";
import type { TimelineEvent } from "../../../../shared/timeline";
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

type ChatState = {
  messages: Message[];
  activeRunId: string | null;
  isCancelling: boolean;
  seenSequences: Set<number>;
  connectionStatus: ConnectionStatus;
};

type ChatAction = 
  | { type: "eventReceived"; event: TimelineEvent }
  | { type: "submissionStarted"; idempotencyKey: string; text: string }
  | { type: "submissionAccepted"; idempotencyKey: string; requestId: string }
  | { type: "connectionChanged"; status: ConnectionStatus }
  | { type: "cancelStarted" }
  | { type: "reset"; payload?: ChatState };

function applyEvent(state: ChatState, event: TimelineEvent): ChatState {
      
      // We rely on the fact that if a user_message arrives, we might already have it bound from submissionAccepted
      if (event.type === "user_message") {
        const exists = state.messages.some(m => m.requestId === event.requestId);
        if (!exists) {
          return {
            ...state,
            messages: [...state.messages, {
              role: "user",
              content: event.data.message,
              requestId: event.requestId,
              status: "delivered"
            }]
          };
        }
        return state;
      }

      
      if (event.type === "run_started") {
        const id = event.requestId;
        const msgs = [...state.messages];
        let existingIdx = msgs.findIndex(m => m.requestId === id && m.role === "assistant");
        
        if (existingIdx === -1) {
          msgs.push({
            role: "assistant",
            content: "",
            requestId: id,
            activities: [],
            effects: []
          });
        }
        return { ...state, messages: msgs, activeRunId: id, isCancelling: false };
      }

      if (event.type === "text") {
        const id = event.requestId;
        const msgs = [...state.messages];
        const existingIdx = msgs.findIndex(m => m.requestId === id && m.role === "assistant");
        
        if (existingIdx >= 0) {
          msgs[existingIdx] = {
            ...msgs[existingIdx],
            content: msgs[existingIdx].content + event.data.text
          };
        } else {
          msgs.push({
            role: "assistant",
            content: event.data.text,
            requestId: id,
            activities: []
          });
        }
        return { ...state, messages: msgs };
      }

      if (event.type === "lifecycle") {
        const id = event.requestId;
        const msgs = [...state.messages];
        let existingIdx = msgs.findIndex(m => m.requestId === id && m.role === "assistant");
        
        if (existingIdx === -1) {
          existingIdx = msgs.length;
          msgs.push({
            role: "assistant",
            content: "",
            requestId: id,
            activities: []
          });
        }
        
        msgs[existingIdx] = {
          ...msgs[existingIdx],
          activities: [...(msgs[existingIdx].activities || []), event.data.event]
        };
        return { ...state, messages: msgs };
      }

      if (event.type === "done" || event.type === "error" || event.type === "interrupted") {
        const id = event.requestId;
        const msgs = [...state.messages];
        const existingIdx = msgs.findIndex(m => m.requestId === id && m.role === "assistant");
        if (existingIdx >= 0) {
          msgs[existingIdx] = { ...msgs[existingIdx], isComplete: true };
          if (event.type === "error") {
             msgs[existingIdx].activities = [...(msgs[existingIdx].activities || []), `Error: ${event.data.error}`];
          }
        }
        return { ...state, messages: msgs, activeRunId: state.activeRunId === id ? null : state.activeRunId, isCancelling: state.activeRunId === id ? false : state.isCancelling };
      }

      if (event.type === "propose_effect") {
        const id = event.requestId;
        const msgs = [...state.messages];
        let existingIdx = msgs.findIndex(m => m.requestId === id && m.role === "assistant");
        
        if (existingIdx === -1) {
          existingIdx = msgs.length;
          msgs.push({
            role: "assistant",
            content: "",
            requestId: id,
            activities: [],
            effects: []
          });
        }
        
        const effect = event.data.effect;
        msgs[existingIdx] = {
          ...msgs[existingIdx],
          effects: [...(msgs[existingIdx].effects || []), effect]
        };
        return { ...state, messages: msgs };
      }

      if (event.type === "effect_status") {
        const msgs = [...state.messages];
        let updated = false;
        
        for (let i = 0; i < msgs.length; i++) {
          const msg = msgs[i];
          if (msg.role === "assistant" && msg.effects) {
            const effectIdx = msg.effects.findIndex(e => e.id === event.data.id);
            if (effectIdx >= 0) {
              const newEffects = [...msg.effects];
              newEffects[effectIdx] = { ...newEffects[effectIdx], status: event.data.status };
              msgs[i] = { ...msg, effects: newEffects };
              updated = true;
              break;
            }
          }
        }
        
        if (updated) {
          return { ...state, messages: msgs };
        }
        return state;
      }

      return state;
    }

function chatReducer(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    case "reset":
      return action.payload || { messages: [], activeRunId: null, isCancelling: false, seenSequences: new Set<number>(), connectionStatus: "connecting" as ConnectionStatus };
      
    case "submissionStarted":
      return {
        ...state,
        messages: [...state.messages, {
          role: "user",
          content: action.text,
          requestId: action.idempotencyKey,
          idempotencyKey: action.idempotencyKey,
          status: "sending"
        }]
      };

    case "submissionAccepted":
      return {
        ...state,
        activeRunId: action.requestId,
        isCancelling: false,
        messages: state.messages.map(m => 
          m.idempotencyKey === action.idempotencyKey 
            ? { ...m, requestId: action.requestId, status: "delivered" } 
            : m
        )
      };

        case "cancelStarted":
      return { ...state, isCancelling: true };
    case "connectionChanged":
      return { ...state, connectionStatus: action.status };
    case "eventReceived": {
      if (state.seenSequences.has(action.event.sequence)) {
        return state;
      }
      const nextState = applyEvent(state, action.event);
      if (nextState !== state) {
        const nextSeen = new Set<number>(state.seenSequences);
        nextSeen.add(action.event.sequence);
        return { ...nextState, seenSequences: nextSeen };
      }
      return state;
    }
    default:
      return state;
  }
}


const sessionCache = new Map<string, { messages: Message[], activeRunId: string | null, seenSequences: Set<number> }>();

function getInitialState(sessionId: string): ChatState {
  const cached = sessionCache.get(sessionId);
  if (cached) {
    return { ...cached, isCancelling: false, connectionStatus: "connecting" };
  }
  return { messages: [], activeRunId: null, isCancelling: false, seenSequences: new Set<number>(), connectionStatus: "connecting" };
}

export function useChatSession(sessionId: string) {
  const [state, dispatch] = useReducer(chatReducer, sessionId, getInitialState);
  const streamRef = useRef<EventSource | null>(null);

  useEffect(() => {
    sessionCache.set(sessionId, { messages: state.messages, activeRunId: state.activeRunId, seenSequences: state.seenSequences });
  }, [sessionId, state.messages, state.activeRunId, state.seenSequences]);

  useEffect(() => {
    const initialState = getInitialState(sessionId);
    dispatch({ type: "reset", payload: initialState });

    const maxSeq = initialState.seenSequences.size > 0 ? Math.max(...initialState.seenSequences) : 0;
    const es = new EventSource(`/api/chat/events?sessionId=${encodeURIComponent(sessionId)}&after=${maxSeq}`);
    streamRef.current = es;

    es.onopen = () => dispatch({ type: "connectionChanged", status: "connected" });
    es.onerror = () => dispatch({ type: "connectionChanged", status: "disconnected" });

    es.onmessage = (e) => {
      const event: TimelineEvent = JSON.parse(e.data);
      dispatch({ type: "eventReceived", event });
    };

    return () => {
      es.close();
    };
  }, [sessionId]);

  const submitMessage = async (text: string, attachmentIds: string[] = []) => {
    if (state.activeRunId || !text.trim()) return;

    const idempotencyKey = crypto.randomUUID();
    dispatch({ type: "submissionStarted", idempotencyKey, text });

    try {
      const res = await fetchWithCsrf("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, message: text, idempotencyKey, attachmentIds })
      });
      
      if (!res.ok) {
        console.error("Failed to send message, server returned:", res.status);
        dispatch({ type: "reset" }); // or handle error state
        return;
      }
      
      const data: { runId?: string } = await res.json();
      if (data.runId) {
        dispatch({ type: "submissionAccepted", idempotencyKey, requestId: data.runId });
      }
    } catch (e) {
      console.error("Failed to send message", e);
    }
  };

  const stop = async () => { dispatch({ type: "cancelStarted" });
    await fetchWithCsrf("/api/chat/interrupt", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId }),
    });
  };

  return { messages: state.messages, activeRunId: state.activeRunId, isCancelling: state.isCancelling, connectionStatus: state.connectionStatus, submitMessage, stop };
}




