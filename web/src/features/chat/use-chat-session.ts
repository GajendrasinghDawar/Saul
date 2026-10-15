import { useEffect, useMemo, useState } from 'react'
import { type Attachment, fetchWithCsrf } from '../../lib/api'
import type { ComposerReply } from './Composer'
import { type ChatView, projectChatView } from './chat-view'
import { mergeDeliveryMessages } from './delivery-messages'
import { useMessageDelivery } from './message-delivery'
import type { AssistantPhase } from './ThinkingIndicator'

export type Message = {
  role: 'user' | 'assistant'
  content: string
  attachments?: Attachment[]
  thinkingContent?: string
  requestId: string
  deliveryId?: string
  status?: 'sending' | 'waiting' | 'delivered' | 'failed'
  activities?: string[]
  effects?: Effect[]
  isComplete?: boolean
  failure?: string
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
  const [canonicalMessages, setCanonicalMessages] = useState<Message[]>([])
  const [activeRunId, setActiveRunId] = useState<string | null>(null)
  const [connectionStatus, setConnectionStatus] =
    useState<ConnectionStatus>('connecting')
  const confirmedEntryIds = useMemo(
    () =>
      canonicalMessages.flatMap(
        message => message.entryIds ?? [message.requestId]
      ),
    [canonicalMessages]
  )
  const {
    pending,
    resolvedConversationId,
    canSend,
    resolveMainConversation,
    sendMessage,
    retryMessage,
    deleteMessage,
  } = useMessageDelivery({ sessionId, confirmedEntryIds })
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
        void resolveMainConversation(String(data.conversationId))
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
  }, [sessionId, resolveMainConversation])

  const messages = mergeDeliveryMessages(canonicalMessages, pending)
  const submitMessage = async (
    text: string,
    attachments: Attachment[] = [],
    replyToEntryId?: string
  ) => {
    try {
      return await sendMessage({
        text,
        attachments,
        replyToEntryId,
      })
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
    resolvedConversationId,
    canQueue: canSend,
    retryMessage,
    deleteMessage,
  }
}
