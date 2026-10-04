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
  return data.conversations.map(
    (c: {
      id: string | number
      created: string
      updated: number
      title?: string
    }) => ({
      id: String(c.id),
      created: c.created,
      updated: c.updated,
      title: c.title,
    })
  )
}

export async function createSession(): Promise<string> {
  const res = await fetchWithCsrf('/api/new-thread', {
    method: 'POST',
  })
  if (!res.ok) throw new Error('Failed to create session')
  const data = await res.json()
  return String(data.conversationId)
}

export async function renameSession(id: string, title: string): Promise<void> {
  const res = await fetchWithCsrf(`/api/conversations/${id}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ title }),
  })
  if (!res.ok) throw new Error('Failed to rename session')
}

export async function deleteSession(id: string): Promise<void> {
  const res = await fetchWithCsrf(`/api/conversations/${id}`, {
    method: 'DELETE',
  })
  if (!res.ok) throw new Error('Failed to delete session')
}
