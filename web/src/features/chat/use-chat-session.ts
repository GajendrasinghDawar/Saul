import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { type Attachment, fetchWithCsrf, responseError } from '../../lib/api'
import {
  type ChatView,
  projectChatView,
  reconcilePendingMessages,
} from './chat-view'
import type { SendAttempt } from './send-attempt'

export type Message = {
  role: 'user' | 'assistant'
  content: string
  attachments?: Attachment[]
  thinkingContent?: string
  requestId: string
  idempotencyKey?: string
  admittedEntryId?: string
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

export function useChatSession(sessionId: string, attempt: SendAttempt) {
  const [messages, setMessages] = useState<Message[]>([])
  const [activeRunId, setActiveRunId] = useState<string | null>(null)
  const [isCancelling, setIsCancelling] = useState(false)
  const [connectionStatus, setConnectionStatus] =
    useState<ConnectionStatus>('connecting')
  const pendingMessagesRef = useRef<Map<string, Message>>(new Map())
  const seenEntriesRef = useRef<Set<string>>(new Set())
  const initializedRef = useRef(false)
  const canonicalMessagesRef = useRef<Message[]>([])

  useEffect(() => {
    setConnectionStatus('connecting')
    setMessages([])
    pendingMessagesRef.current.clear()
    seenEntriesRef.current.clear()
    initializedRef.current = false

    const processView = (view: ChatView) => {
      const projection = projectChatView(view)
      canonicalMessagesRef.current = projection.messages

      reconcilePendingMessages(
        projection.messages,
        pendingMessagesRef.current,
        seenEntriesRef.current
      )
      initializedRef.current = true

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
    attachments: Attachment[] = [],
    whenBusy?: 'followUp' | 'steer' | 'reject'
  ) => {
    if (
      (activeRunId && whenBusy !== 'steer') ||
      connectionStatus !== 'connected' ||
      !initializedRef.current ||
      (!text.trim() && attachments.length === 0)
    ) {
      return false
    }

    const idempotencyKey = attempt.requestId(
      text,
      attachments.map(file => file.id),
      whenBusy
    )
    const pendingMessage: Message = {
      role: 'user',
      content: text,
      attachments,
      requestId: idempotencyKey,
      idempotencyKey,
      status: 'sending',
    }

    pendingMessagesRef.current.set(idempotencyKey, pendingMessage)
    setMessages(current => [
      ...current.filter(message => message.requestId !== idempotencyKey),
      pendingMessage,
    ])

    try {
      const response = await fetchWithCsrf('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requestId: idempotencyKey,
          conversationId: sessionId === 'main' ? undefined : sessionId,
          message: text,
          attachmentIds: attachments.map(file => file.id),
          whenBusy,
        }),
      })

      if (!response.ok) {
        throw new Error(await responseError(response))
      }
      const data = (await response.json()) as { result: { entry?: number } }
      const admittedEntryId =
        data.result.entry === undefined ? undefined : String(data.result.entry)
      if (
        admittedEntryId &&
        !canonicalMessagesRef.current.some(
          message => message.requestId === admittedEntryId
        )
      ) {
        pendingMessagesRef.current.set(idempotencyKey, {
          ...pendingMessage,
          requestId: admittedEntryId,
          admittedEntryId,
          status: 'delivered',
        })
      } else {
        pendingMessagesRef.current.delete(idempotencyKey)
      }
      setMessages([
        ...canonicalMessagesRef.current,
        ...pendingMessagesRef.current.values(),
      ])
      attempt.confirmed(idempotencyKey)
      return true
    } catch (error) {
      // Text alone cannot confirm which same-text request was delivered.
      console.error('Failed to send message', error)
      toast.error(
        error instanceof Error
          ? error.message
          : 'Failed to send message. Please try again.'
      )

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
      return false
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
