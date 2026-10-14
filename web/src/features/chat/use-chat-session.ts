import { useEffect, useState } from 'react'
import { type Attachment, fetchWithCsrf } from '../../lib/api'
import type { ComposerReply } from './Composer'
import { useChatOutbox } from './chat-drafts'
import { type ChatView, projectChatView } from './chat-view'
import type { BusyPolicy } from './outbox'
import type { AssistantPhase } from './ThinkingIndicator'

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
  reply?: ComposerReply
  phase?: AssistantPhase
  entryIds?: string[]
  replyEntryId?: string
  replyText?: string
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
  conversationId?: string
}

export function useChatSession(sessionId: string) {
  const { outbox, items, paused, main } = useChatOutbox()
  const [canonicalMessages, setCanonicalMessages] = useState<Message[]>([])
  const [activeRunId, setActiveRunId] = useState<string | null>(null)
  const [connectionStatus, setConnectionStatus] =
    useState<ConnectionStatus>('connecting')
  useEffect(() => {
    setConnectionStatus('connecting')
    setCanonicalMessages([])
    setActiveRunId(null)
    let es: EventSource | undefined
    const receive = (event: MessageEvent<string>) => {
      const data = JSON.parse(event.data) as StreamEvent
      if ((data.type !== 'init' && data.type !== 'update') || !data.view) return
      setConnectionStatus('connected')
      if (sessionId === 'main' && data.conversationId)
        void outbox.rememberMain(String(data.conversationId))
      const projection = projectChatView(data.view)
      setCanonicalMessages(projection.messages)
      setActiveRunId(projection.activeRunId)
      if (!projection.isBusy && sessionStorage.getItem(`busy-${sessionId}`)) {
        sessionStorage.removeItem(`busy-${sessionId}`)
        window.dispatchEvent(new CustomEvent('chat-updated'))
      } else if (projection.isBusy)
        sessionStorage.setItem(`busy-${sessionId}`, 'true')
    }
    const connect = () => {
      es?.close()
      setConnectionStatus(navigator.onLine ? 'connecting' : 'disconnected')
      if (!navigator.onLine) return
      es = new EventSource(
        `/api/stream?conversationId=${sessionId === 'main' ? '' : encodeURIComponent(sessionId)}`
      )
      es.onerror = () => setConnectionStatus('disconnected')
      es.onmessage = receive
    }
    const offline = () => {
      es?.close()
      setConnectionStatus('disconnected')
    }
    window.addEventListener('offline', offline)
    window.addEventListener('online', connect)
    connect()
    return () => {
      es?.close()
      window.removeEventListener('offline', offline)
      window.removeEventListener('online', connect)
    }
  }, [sessionId, outbox])

  useEffect(() => {
    const ids = canonicalMessages.flatMap(
      message => message.entryIds ?? [message.requestId]
    )
    if (
      items.some(
        item => item.admittedEntryId && ids.includes(item.admittedEntryId)
      )
    )
      void outbox.acknowledge(ids)
  }, [canonicalMessages, items, outbox])

  const outboxItems = items.filter(
    item => item.conversationId === (sessionId === 'main' ? main : sessionId)
  )
  const messages: Message[] = [
    ...canonicalMessages,
    ...outboxItems
      .filter(
        item =>
          !item.admittedEntryId ||
          !canonicalMessages.some(
            message => message.requestId === item.admittedEntryId
          )
      )
      .map(
        (item): Message => ({
          role: 'user',
          content: item.message,
          attachments: item.attachments,
          requestId: item.admittedEntryId ?? item.requestId,
          idempotencyKey: item.requestId,
          admittedEntryId: item.admittedEntryId,
          reply: item.replyToEntryId
            ? {
                entryId: item.replyToEntryId,
                role: 'message',
                text: 'Open referenced message',
              }
            : undefined,
          status:
            item.status === 'delivered'
              ? 'delivered'
              : item.status === 'failed' || item.status === 'unknown'
                ? 'failed'
                : 'sending',
        })
      ),
  ]
  const submitMessage = async (
    text: string,
    attachments: Attachment[] = [],
    whenBusy?: BusyPolicy,
    replyToEntryId?: string
  ) => {
    try {
      return await outbox.enqueue(
        sessionId,
        text,
        attachments,
        whenBusy,
        replyToEntryId
      )
    } catch (error) {
      console.error('Could not persist send', error)
      return false
    }
  }
  const forkMessage = async (messageId: string) => {
    const response = await fetchWithCsrf(`/api/fork/${messageId}`, {
      method: 'POST',
    })
    if (!response.ok) throw new Error('Failed to fork conversation')
    const data = (await response.json()) as { newConversationId: string }
    window.dispatchEvent(new CustomEvent('chat-updated'))
    return data.newConversationId
  }
  return {
    messages,
    activeRunId,
    connectionStatus,
    submitMessage,
    forkMessage,
    resolvedConversationId: sessionId === 'main' ? main : sessionId,
    canQueue:
      Boolean(navigator.locks) &&
      !paused &&
      (sessionId !== 'main' || Boolean(main)),
    outboxItems,
    outboxStatus: paused ? ('paused' as const) : ('ready' as const),
    retryOutboxItem: (requestId: string) => outbox.retry(requestId),
    removeOutboxItem: (requestId: string) => outbox.remove(requestId),
  }
}
