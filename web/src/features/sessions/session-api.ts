import { fetchWithCsrf } from '../../lib/api'

export type SessionItem = {
  id: string // The conversation ID from pi-durable
  title?: string
  created: number
  updated: number
}

export async function fetchSessions(): Promise<SessionItem[]> {
  const res = await fetchWithCsrf('/api/conversations')
  if (!res.ok) throw new Error('Failed to fetch sessions')
  const data = await res.json()
  return data.conversations.map((c: { id: string | number; created: string }) => ({
    id: String(c.id),
    created: c.created,
    updated: c.updated,
  }))
}

export async function createSession(): Promise<string> {
  const res = await fetchWithCsrf('/api/new-thread', {
    method: 'POST',
  })
  if (!res.ok) throw new Error('Failed to create session')
  const data = await res.json()
  return String(data.conversationId)
}
