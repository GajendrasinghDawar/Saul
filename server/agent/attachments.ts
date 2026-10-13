import type { Models } from '@earendil-works/pi-ai'
import {
  AgentDoc,
  CompactionTask,
  defineExtension,
  GenerationTask,
  hook,
} from '@earendil-works/pi-durable'
import {
  type AttachmentStore,
  attachmentReference,
} from '../services/attachments.ts'
import { getUserIdForConversation } from './data.ts'

export function createAttachmentExtension(
  store: AttachmentStore,
  models: Models
) {
  return defineExtension({
    name: 'attachments',
    hooks: [
      hook(GenerationTask, {
        beforeRequest: async (request, api, context) => {
          if (!hasReferences(request.messages)) return undefined
          const userId = await getUserIdForConversation(
            String(api.conversationId)
          )
          const agent = await api.snapshot(
            AgentDoc,
            api.conversationId,
            context
          )
          const ref = agent?.model
          const model = ref
            ? models.getModel(ref.provider, ref.modelId)
            : undefined
          return {
            messages: await store.hydrate(
              request.messages,
              userId,
              Boolean(model?.input.includes('image'))
            ),
          }
        },
      }),
      hook(CompactionTask, {
        // Pi's compactor has no context-replacement hook. Do not summarize file
        // references as though they were the file content, then drop the originals.
        beforeCompact: request =>
          hasReferences(request.messages) ? { decline: true } : undefined,
      }),
    ],
  })
}

function hasReferences(
  messages: readonly { role: string; content: unknown }[]
) {
  return messages.some(
    message =>
      message.role === 'user' &&
      Array.isArray(message.content) &&
      message.content.some(
        part =>
          part.type === 'text' &&
          typeof part.text === 'string' &&
          attachmentReference(part.text)
      )
  )
}
