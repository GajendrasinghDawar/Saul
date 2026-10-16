import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useState,
} from 'react'
import { fetchSessions, type SessionItem } from './session-api'

const SessionContext = createContext<{
  sessions: SessionItem[]
  refresh: () => Promise<void>
} | null>(null)

export function SessionProvider({ children }: { children: ReactNode }) {
  const [sessions, setSessions] = useState<SessionItem[]>([])
  const refresh = useCallback(async () => {
    try {
      const items = await fetchSessions()
      items.sort((a, b) => b.updated - a.updated)
      setSessions(items)
    } catch (error) {
      console.error('Could not load conversations', error)
    }
  }, [])
  useEffect(() => {
    void refresh()
    const update = () => void refresh()
    window.addEventListener('chat-updated', update)
    window.addEventListener('visibilitychange', update)
    return () => {
      window.removeEventListener('chat-updated', update)
      window.removeEventListener('visibilitychange', update)
    }
  }, [refresh])
  return (
    <SessionContext.Provider value={{ sessions, refresh }}>
      {children}
    </SessionContext.Provider>
  )
}

export function useSessions() {
  const value = useContext(SessionContext)
  if (!value) throw new Error('Sessions require SessionProvider')
  return value
}
