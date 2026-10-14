import { useCallback, useEffect } from 'react'
import type { Attachment } from '../../lib/api'
import { useChatOutbox } from './chat-drafts'

export type DeliveryState = 'sending' | 'waiting' | 'failed' | 'delivered'

export type PendingDelivery = {
  id: string
  canonicalId?: string
  conversationId: string
  content: string
  attachments: Attachment[]
  replyToEntryId?: string
  state: DeliveryState
  attempted: boolean
  error?: string
}

type SendMessage = {
  text: string
  attachments?: Attachment[]
  replyToEntryId?: string
}

type UseMessageDeliveryOptions = {
  sessionId: string
  confirmedEntryIds: string[]
}

// This is the seam between chat and message delivery. The UI consumes these
// normalized operations and does not know whether delivery is direct or durable.
export function useMessageDelivery({
  sessionId,
  confirmedEntryIds,
}: UseMessageDeliveryOptions) {
  const { outbox, items, paused, main } = useChatOutbox()

  useEffect(() => {
    if (
      items.some(
        item =>
          item.admittedEntryId && confirmedEntryIds.includes(item.admittedEntryId)
      )
    )
      void outbox.acknowledge(confirmedEntryIds)
  }, [confirmedEntryIds, items, outbox])

  const conversationId = sessionId === 'main' ? main : sessionId
  const pending: PendingDelivery[] = items
    .filter(item => item.conversationId === conversationId)
    .filter(
      item =>
        !item.admittedEntryId ||
        !confirmedEntryIds.includes(item.admittedEntryId)
    )
    .map(item => ({
      id: item.requestId,
      canonicalId: item.admittedEntryId,
      conversationId: item.conversationId,
      content: item.message,
      attachments: item.attachments,
      replyToEntryId: item.replyToEntryId,
      attempted: item.attempts > 0,
      state:
        item.status === 'delivered'
          ? 'delivered'
          : item.status === 'failed'
            ? 'failed'
            : !navigator.onLine
              ? 'waiting'
              : 'sending',
      error: item.error,
    }))

  const resolveMainConversation = useCallback(
    (id: string) => outbox.rememberMain(id),
    [outbox]
  )
  const sendMessage = useCallback(
    ({ text, attachments = [], replyToEntryId }: SendMessage) =>
      outbox.enqueue(
        sessionId,
        text,
        attachments,
        'followUp',
        replyToEntryId
      ),
    [outbox, sessionId]
  )
  const retryMessage = useCallback((id: string) => outbox.retry(id), [outbox])
  const deleteMessage = useCallback(
    async (id: string) => {
      const item = items.find(candidate => candidate.requestId === id)
      if (
        item?.attempts &&
        !window.confirm(
          'This message may already have reached the server. Stop retrying and remove it from this device?'
        )
      )
        return false
      return outbox.remove(id)
    },
    [items, outbox]
  )

  return {
    pending,
    resolvedConversationId: conversationId,
    canSend:
      Boolean(navigator.locks) &&
      !paused &&
      (sessionId !== 'main' || Boolean(main)),
    resolveMainConversation,
    sendMessage,
    retryMessage,
    deleteMessage,
  }
}
