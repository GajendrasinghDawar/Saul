import type { Attachment } from '../../lib/api'
import type { ComposerReply } from './Composer'
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
  errorMessage?: string
}

type ViewEntry = {
  id: string | number
  kind: string
  model?: ModelMessage[]
  data?: { id?: string; status?: string; summary?: string }
}

type LiveState = {
  run?: { taskId: string | number }
  generation?: { message?: ModelMessage }
  tools?: {
    name: string
    status: 'pending' | 'running' | 'done'
    output?: string
  }[]
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

function parseUserContent(content: ModelMessage['content']) {
  const attachments: Attachment[] = []
  let reply: ComposerReply | undefined
  if (typeof content === 'string') return { text: content, attachments }
  let text = ''
  for (const part of content ?? []) {
    if (part.type !== 'text') continue
    const value = part.text ?? ''
    if (value.startsWith('saul:reply-context:')) continue
    if (value.startsWith('saul:reply:')) {
      try {
        const reference: unknown = JSON.parse(value.slice('saul:reply:'.length))
        if (
          typeof reference === 'object' &&
          reference !== null &&
          'entryId' in reference &&
          typeof reference.entryId === 'number' &&
          Number.isSafeInteger(reference.entryId) &&
          reference.entryId > 0 &&
          'role' in reference &&
          (reference.role === 'user' || reference.role === 'assistant') &&
          'text' in reference &&
          typeof reference.text === 'string'
        )
          reply = {
            entryId: String(reference.entryId),
            role: reference.role,
            text: reference.text,
          }
      } catch {
        /* Internal malformed reference metadata is never transcript prose. */
      }
      continue
    }
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
  return { text, attachments, reply }
}

function createAssistant(requestId: string): Message {
  return {
    role: 'assistant',
    content: '',
    requestId,
    activities: [],
    effects: [],
    entryIds: [],
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
    if (entry.kind === 'lali.approval' && entry.data?.id) {
      if (!currentAssistant) {
        currentAssistant = createAssistant(String(entry.id))
        messages.push(currentAssistant)
      }
      const status = entry.data.status
      if (
        status === 'pending' ||
        status === 'approved' ||
        status === 'rejected' ||
        status === 'interrupted'
      ) {
        const previous = currentAssistant.effects?.find(
          effect => effect.id === entry.data?.id
        )
        if (previous) previous.status = status
        else
          currentAssistant.effects?.push({
            id: entry.data.id,
            type: 'approval',
            summary: entry.data.summary ?? 'Action requires your approval',
            status,
          })
        if (status !== 'pending')
          currentAssistant.activities?.push(
            `Approval ${status}: ${entry.data.summary ?? 'requested action'}`
          )
      }
      continue
    }
    if (entry.kind === 'pi.user') {
      if (currentAssistant) currentAssistant.isComplete = true
      const { text, attachments, reply } = parseUserContent(model?.content)
      messages.push({
        role: 'user',
        content: text,
        attachments,
        requestId: String(entry.id),
        status: 'delivered',
        reply,
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
      currentAssistant.entryIds?.push(String(entry.id))
      if (model?.stopReason === 'error')
        currentAssistant.failure =
          'The assistant could not reply. Check model settings and try again.'
      const text =
        typeof model?.content === 'string'
          ? model.content
          : model?.content
              ?.filter(part => part.type === 'text')
              .map(part => part.text ?? '')
              .join('')
      if (text) {
        currentAssistant.replyEntryId = String(entry.id)
        currentAssistant.replyText = text
      }
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
    const content = live.generation?.message?.content
    const parts =
      typeof content === 'string'
        ? [{ type: 'text', text: content }]
        : (content ?? [])
    const tools = live.tools?.filter(tool => tool.status !== 'done') ?? []
    currentAssistant.phase = tools.length
      ? 'tool'
      : parts.some(part => part.type === 'text' && part.text)
        ? 'writing'
        : parts.some(part => part.type === 'thinking' && part.thinking)
          ? 'thinking'
          : 'waiting'
    for (const tool of tools)
      currentAssistant.activities?.push(
        `${tool.name}: ${tool.status}${tool.output ? `\n${tool.output}` : ''}`
      )
    return {
      messages,
      activeRunId: currentAssistant.requestId,
      isBusy: true,
    }
  }

  if (currentAssistant) currentAssistant.isComplete = true
  return { messages, activeRunId: null, isBusy: false }
}
