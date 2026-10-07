import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { fetchWithCsrf } from '../../lib/api'
import { type ChatView, projectChatView } from './chat-view'

export type Message = {
  role: 'user' | 'assistant'
  content: string
  thinkingContent?: string
  requestId: string
  idempotencyKey?: string
  status?: 'sending' | 'delivered' | 'failed'
  activities?: string[]
  effects?: Effect[]
  isComplete?: boolean
}

export type Effect = {
  id: string
  summary?: string
  type?: string
  payload?: unknown
  data?: unknown
  digest?: string
  status?:
    | 'pending'
    | 'approved'
    | 'rejected'
    | 'running'
    | 'executed'
    | 'failed'
    | 'expired'
    | 'interrupted'
    | 'unknown'
}

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected'

type StreamEvent = {
  type?: 'init' | 'update'
  view?: ChatView
}

export function useChatSession(sessionId: string) {
  const [messages, setMessages] = useState<Message[]>([])
  const [activeRunId, setActiveRunId] = useState<string | null>(null)
  const [isCancelling, setIsCancelling] = useState(false)
  const [connectionStatus, setConnectionStatus] =
    useState<ConnectionStatus>('connecting')
  const pendingMessagesRef = useRef<Map<string, Message>>(new Map())

  useEffect(() => {
    setConnectionStatus('connecting')
    setMessages([])
    pendingMessagesRef.current.clear()

    const processView = (view: ChatView) => {
      const projection = projectChatView(view)

      for (const message of projection.messages) {
        if (message.role !== 'user') continue
        for (const [key, pending] of pendingMessagesRef.current.entries()) {
          if (pending.content === message.content) {
            pendingMessagesRef.current.delete(key)
          }
        }
      }

      setActiveRunId(projection.activeRunId)
      if (
        !projection.isBusy &&
        window.sessionStorage.getItem(`busy-${sessionId}`)
      ) {
        window.sessionStorage.removeItem(`busy-${sessionId}`)
        window.dispatchEvent(new CustomEvent('chat-updated'))
      } else if (projection.isBusy) {
        window.sessionStorage.setItem(`busy-${sessionId}`, 'true')
      }

      setMessages([
        ...projection.messages,
        ...pendingMessagesRef.current.values(),
      ])
    }

    const es = new EventSource(
      `/api/stream?conversationId=${sessionId === 'main' ? '' : sessionId}`
    )

    es.onopen = () => setConnectionStatus('connected')
    es.onerror = () => setConnectionStatus('disconnected')
    es.onmessage = event => {
      const data = JSON.parse(event.data) as StreamEvent
      if ((data.type === 'init' || data.type === 'update') && data.view) {
        processView(data.view)
      }
    }

    return () => es.close()
  }, [sessionId])

  const submitMessage = async (
    text: string,
    attachmentIds: string[] = [],
    whenBusy?: 'queue' | 'steer' | 'reject'
  ) => {
    if (
      (activeRunId && whenBusy !== 'steer') ||
      (!text.trim() && attachmentIds.length === 0)
    ) {
      return
    }

    const idempotencyKey =
      typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : Date.now().toString(36) + Math.random().toString(36).substring(2)
    const pendingMessage: Message = {
      role: 'user',
      content: text,
      requestId: idempotencyKey,
      idempotencyKey,
      status: 'sending',
    }

    pendingMessagesRef.current.set(idempotencyKey, pendingMessage)
    setMessages(current => [...current, pendingMessage])

    try {
      const response = await fetchWithCsrf('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversationId: sessionId === 'main' ? undefined : sessionId,
          message: text,
          attachmentIds,
          whenBusy,
        }),
      })

      if (!response.ok) {
        throw new Error(`Failed to send message: ${response.status}`)
      }
    } catch (error) {
      console.error('Failed to send message', error)
      if (error instanceof Error && error.message.includes('404')) {
        toast.error('Conversation not found. It may have been deleted.')
      } else {
        toast.error('Failed to send message. Please try again.')
      }

      const pending = pendingMessagesRef.current.get(idempotencyKey)
      if (pending) {
        const failed: Message = { ...pending, status: 'failed' }
        pendingMessagesRef.current.set(idempotencyKey, failed)
        setMessages(current =>
          current.map(message =>
            message.requestId === idempotencyKey ? failed : message
          )
        )
      }
    }
  }

  const stop = async () => {
    setIsCancelling(true)
    // TODO: implement interrupt in pi-durable if needed
    setTimeout(() => setIsCancelling(false), 2000)
  }

  const forkMessage = async (messageId: string) => {
    try {
      const response = await fetchWithCsrf(`/api/fork/${messageId}`, {
        method: 'POST',
      })
      if (!response.ok) throw new Error('Failed to fork conversation')
      const data = (await response.json()) as { newConversationId: string }
      window.dispatchEvent(new CustomEvent('chat-updated'))
      return data.newConversationId
    } catch (error) {
      console.error('Fork failed', error)
      throw error
    }
  }

  return {
    messages,
    activeRunId,
    isCancelling,
    connectionStatus,
    submitMessage,
    stop,
    forkMessage,
  }
}
