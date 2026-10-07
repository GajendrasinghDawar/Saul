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
      const content = model?.content
      const text =
        typeof content === 'string'
          ? content
          : (content ?? [])
              .filter(part => part.type === 'text')
              .map(part => part.text ?? '')
              .join('')
      messages.push({
        role: 'user',
        content: text,
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
