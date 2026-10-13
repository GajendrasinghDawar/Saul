import type { Attachment } from '../../lib/api'
import type { Message } from './use-chat-session'

type ContentPart = {
  type: string
  text?: string
  thinking?: string
  name?: string
}

type ModelMessage = {
  content?: string | ContentPart[]
  stopReason?: string | null
}

type ViewEntry = {
  id: string | number
  kind: string
  model?: ModelMessage[]
}

type LiveState = {
  run?: { taskId: string | number }
  generation?: { message?: ModelMessage }
}

export type ChatView = {
  entries?: ViewEntry[]
  docs?: { 'pi.live'?: LiveState }
}

export type ChatProjection = {
  messages: Message[]
  activeRunId: string | null
  isBusy: boolean
}

export function reconcilePendingMessages(
  canonical: Message[],
  pending: Map<string, Message>,
  seen: Set<string>
) {
  for (const message of canonical) {
    if (message.role !== 'user' || seen.has(message.requestId)) continue
    seen.add(message.requestId)
    for (const [key, candidate] of [...pending].sort(
      (a, b) =>
        Number(a[1].status === 'failed') - Number(b[1].status === 'failed')
    )) {
      const ids = (message.attachments ?? []).map(file => file.id).sort()
      const pendingIds = (candidate.attachments ?? [])
        .map(file => file.id)
        .sort()
      if (
        message.content === candidate.content &&
        JSON.stringify(ids) === JSON.stringify(pendingIds)
      ) {
        pending.delete(key)
        break
      }
    }
  }
}

function parseUserContent(content: ModelMessage['content']) {
  const attachments: Attachment[] = []
  if (typeof content === 'string') return { text: content, attachments }
  let text = ''
  for (const part of content ?? []) {
    if (part.type !== 'text') continue
    const value = part.text ?? ''
    if (value.startsWith('saul:text:')) {
      text += value.slice('saul:text:'.length)
      continue
    }
    if (!value.startsWith('saul:attachment:')) {
      text += value
      continue
    }
    try {
      const file: unknown = JSON.parse(value.slice('saul:attachment:'.length))
      if (
        typeof file === 'object' &&
        file !== null &&
        'id' in file &&
        typeof file.id === 'string' &&
        'name' in file &&
        typeof file.name === 'string' &&
        'mimeType' in file &&
        typeof file.mimeType === 'string' &&
        'size' in file &&
        typeof file.size === 'number' &&
        Number.isFinite(file.size) &&
        file.size >= 0
      ) {
        attachments.push({
          id: file.id,
          name: file.name,
          mimeType: file.mimeType,
          size: file.size,
        })
      }
    } catch {
      /* Never expose internal attachment markers in the transcript. */
    }
  }
  return { text, attachments }
}

function createAssistant(requestId: string): Message {
  return {
    role: 'assistant',
    content: '',
    requestId,
    activities: [],
    effects: [],
  }
}

function appendAssistantContent(
  message: Message,
  content: ModelMessage['content']
) {
  if (typeof content === 'string') {
    message.content += content
    return
  }

  for (const part of content ?? []) {
    if (part.type === 'text') {
      message.content += part.text ?? ''
    } else if (part.type === 'thinking') {
      message.thinkingContent =
        (message.thinkingContent ?? '') + (part.thinking ?? '')
    } else if (part.type === 'toolCall') {
      message.activities?.push(`Using Tool: ${part.name ?? 'unknown'}`)
    }
  }
}

export function projectChatView(view: ChatView): ChatProjection {
  const messages: Message[] = []
  let currentAssistant: Message | null = null

  for (const entry of view.entries ?? []) {
    const model = entry.model?.[0]
    if (entry.kind === 'pi.user') {
      if (currentAssistant) currentAssistant.isComplete = true
      const { text, attachments } = parseUserContent(model?.content)
      messages.push({
        role: 'user',
        content: text,
        attachments,
        requestId: String(entry.id),
        status: 'delivered',
      })
      currentAssistant = null
      continue
    }

    if (entry.kind === 'pi.assistant') {
      if (!currentAssistant) {
        currentAssistant = createAssistant(String(entry.id))
        messages.push(currentAssistant)
      }
      appendAssistantContent(currentAssistant, model?.content)
      continue
    }

    if (entry.kind === 'pi.tool-result' && currentAssistant) {
      const content = model?.content
      const text =
        typeof content === 'string'
          ? content
          : ((content ?? []).find(part => part.type === 'text')?.text ?? '')
      if (text.startsWith('[APPROVAL REQUIRED]')) {
        const proposalId = text.match(/Proposal ID: (.*?)\./)?.[1]
        if (proposalId) {
          currentAssistant.effects?.push({
            id: proposalId,
            type: 'approval',
            summary: 'Action requires your approval',
            status: 'pending',
          })
        }
      } else {
        currentAssistant.activities?.push(`Result: ${text.substring(0, 50)}...`)
      }
    }
  }

  const live = view.docs?.['pi.live']
  const isBusy = live?.run !== undefined

  if (isBusy) {
    if (!currentAssistant) {
      currentAssistant = createAssistant(`live-${String(live.run?.taskId)}`)
      messages.push(currentAssistant)
    }
    appendAssistantContent(currentAssistant, live.generation?.message?.content)
    return {
      messages,
      activeRunId: currentAssistant.requestId,
      isBusy: true,
    }
  }

  if (currentAssistant) currentAssistant.isComplete = true
  return { messages, activeRunId: null, isBusy: false }
}
