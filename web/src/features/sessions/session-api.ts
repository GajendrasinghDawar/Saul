import { fetchWithCsrf } from "../../lib/api";

export type SessionItem = {
  sessionId: string;
  title: string;
  status: "active" | "archived";
  type: string;
  hasRunningTasks?: boolean;
};

export async function fetchSessions(): Promise<SessionItem[]> {
  const res = await fetchWithCsrf("/api/sessions");
  if (!res.ok) throw new Error("Failed to fetch sessions");
  const data = await res.json();
  return data.sessions;
}

export async function createSession(title: string): Promise<string> {
  const res = await fetchWithCsrf("/api/sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title, type: "project" })
  });
  if (!res.ok) throw new Error("Failed to create session");
  const data = await res.json();
  return data.sessionId;
}

export async function archiveSession(id: string): Promise<void> {
  const res = await fetchWithCsrf(`/api/sessions/${id}/archive`, { method: "PUT" });
  if (!res.ok) throw new Error("Failed to archive session");
}

export async function restoreSession(id: string): Promise<void> {
  const res = await fetchWithCsrf(`/api/sessions/${id}/restore`, { method: "PUT" });
  if (!res.ok) throw new Error("Failed to restore session");
}

export async function resetSession(id: string): Promise<void> {
  const res = await fetchWithCsrf(`/api/sessions/${id}/reset`, { method: "POST" });
  if (!res.ok) throw new Error("Failed to reset session");
}

export async function deleteSession(id: string): Promise<void> {
  const res = await fetchWithCsrf(`/api/sessions/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error("Failed to delete session");
}
