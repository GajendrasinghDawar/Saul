import { fetchWithCsrf, responseError } from '../../lib/api.ts'

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

async function conversationCommand(
  userId: string,
  path: string
): Promise<string> {
  const key = `saul-conversation-command:${JSON.stringify([userId, path])}`
  const requestId = localStorage.getItem(key) ?? crypto.randomUUID()
  localStorage.setItem(key, requestId)
  const clear = () => {
    if (localStorage.getItem(key) === requestId) localStorage.removeItem(key)
  }
  for (let attempt = 0; ; attempt++) {
    let res: Response
    try {
      res = await fetchWithCsrf(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId }),
        signal: AbortSignal.timeout(15_000),
      })
    } catch (error) {
      if (attempt === 0) continue
      throw error
    }
    if (res.status >= 500 && attempt === 0) continue
    if (!res.ok) {
      // Authentication/CSRF rejection says nothing about an earlier attempt
      // whose response was lost. Keep its ID across sign-in and retry.
      if ([400, 404, 409].includes(res.status)) clear()
      throw new Error(await responseError(res))
    }
    const data = await res.json()
    const id = data.conversationId ?? data.newConversationId
    if (!Number.isSafeInteger(Number(id)) || Number(id) < 1)
      throw new Error('Chat creation was not confirmed. Retry the operation.')
    clear()
    return String(id)
  }
}

export function createSession(userId: string): Promise<string> {
  return conversationCommand(userId, '/api/new-thread')
}

export function forkSession(
  userId: string,
  messageId: string
): Promise<string> {
  return conversationCommand(
    userId,
    `/api/fork/${encodeURIComponent(messageId)}`
  )
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
