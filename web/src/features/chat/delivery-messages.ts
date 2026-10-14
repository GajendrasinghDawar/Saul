import type { Attachment } from '../../lib/api'
import type { PendingDelivery } from './message-delivery'
import type { Message } from './use-chat-session'

function pendingMessage(pending: PendingDelivery): Message {
  return {
    role: 'user',
    content: pending.content,
    attachments: pending.attachments,
    requestId: pending.canonicalId ?? pending.id,
    deliveryId: pending.id,
    reply: pending.replyToEntryId
      ? {
          entryId: pending.replyToEntryId,
          role: 'message',
          text: 'Open referenced message',
        }
      : undefined,
    status: pending.state,
  }
}

function sameAttachments(
  canonical: Attachment[] | undefined,
  pending: Attachment[]
) {
  const left = canonical ?? []
  return (
    left.length === pending.length &&
    left.every((attachment, index) => attachment.id === pending[index]?.id)
  )
}

function sameSubmission(canonical: Message, pending: PendingDelivery) {
  return (
    canonical.role === 'user' &&
    canonical.content === pending.content &&
    sameAttachments(canonical.attachments, pending.attachments) &&
    canonical.reply?.entryId === pending.replyToEntryId
  )
}

function activeUserMessages(canonical: Message[]) {
  const assistantIndex = canonical.findLastIndex(
    message => message.role === 'assistant' && !message.isComplete
  )
  if (assistantIndex < 0) return []

  let firstUser = assistantIndex
  while (firstUser > 0 && canonical[firstUser - 1]?.role === 'user') firstUser--
  return canonical.slice(firstUser, assistantIndex)
}

export function mergeDeliveryMessages(
  canonical: Message[],
  pending: PendingDelivery[]
): Message[] {
  const hidden = new Set<string>()
  const activeUsers = activeUserMessages(canonical)

  for (const user of activeUsers) {
    const match = pending.find(
      candidate =>
        candidate.attempted &&
        !hidden.has(candidate.id) &&
        sameSubmission(user, candidate)
    )
    if (match) hidden.add(match.id)
  }

  return [
    ...canonical,
    ...pending.filter(item => !hidden.has(item.id)).map(pendingMessage),
  ]
}
