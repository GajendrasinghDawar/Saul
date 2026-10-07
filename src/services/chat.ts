import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import {
  type ConversationId,
  configure,
  type EntryId,
  type Harness,
} from '@earendil-works/pi-durable'
import { eq } from 'drizzle-orm'
import { ReminderExtension } from '../agent/reminders.ts'
import { SubagentExtension } from '../agent/subagents/tool.ts'
import { LaliExtension } from '../agent/tools.ts'
import { db } from '../db/index.ts'
import { userConversations } from '../db/schema.ts'

export class ChatService {
  harness: Harness
  providerName: string
  modelId: string

  constructor(harness: Harness, providerName: string, modelId: string) {
    this.harness = harness
    this.providerName = providerName
    this.modelId = modelId
  }

  async getOrCreateMainConversationId(userId: string): Promise<ConversationId> {
    const records = await db
      .select()
      .from(userConversations)
      .where(eq(userConversations.userId, userId))
      .limit(1)

    if (records.length > 0) {
      const cid = Number(records[0].conversationId) as ConversationId

      // Verify it exists in pi-durable
      const conv = await this.harness.conversation(cid, BACKGROUND_CONTEXT)
      if (conv) {
        return cid
      }

      // Dangling reference (e.g. pi-durable db was reset) - clean it up
      await db
        .delete(userConversations)
        .where(eq(userConversations.userId, userId))
    }

    return await this.createConversation(userId)
  }

  async createConversation(userId: string): Promise<ConversationId> {
    const convRecord = await this.harness.commit(async tx => {
      return tx.createConversation({ ownership: { kind: 'ownerless' } })
    }, BACKGROUND_CONTEXT)

    await this.harness.commit(async tx => {
      await configure(tx, convRecord.id, {
        model: { provider: this.providerName, modelId: this.modelId },
        extensions: {
          add: [LaliExtension, SubagentExtension, ReminderExtension],
        },
      })
    }, BACKGROUND_CONTEXT)

    await db
      .insert(userConversations)
      .values({ conversationId: String(convRecord.id), userId })

    return convRecord.id
  }

  async submitMessage(
    conversationId: ConversationId,
    message: string,
    whenBusy: 'followUp' | 'reject' | 'steer' | undefined
  ) {
    const conv = await this.harness.conversation(
      conversationId,
      BACKGROUND_CONTEXT
    )
    if (!conv) return null

    // Opportunistic Title Generation in a Pi-Durable Background Task
    const records = await db
      .select({ title: userConversations.title })
      .from(userConversations)
      .where(eq(userConversations.conversationId, String(conversationId)))
      .limit(1)

    if (records.length > 0 && !records[0].title) {
      // Run as a background durable commit, deferring the execution
      this.harness
        .commit(async () => {
          // Simple heuristic for title (can be upgraded to LLM call later)
          const newTitle =
            message.length > 30 ? `${message.substring(0, 30)}...` : message
          await db
            .update(userConversations)
            .set({ title: newTitle })
            .where(eq(userConversations.conversationId, String(conversationId)))
        }, BACKGROUND_CONTEXT)
        .catch(console.error)
    }

    const submission = await conv.submit(
      { type: 'input', content: message, whenBusy },
      BACKGROUND_CONTEXT
    )
    return await submission.wait(BACKGROUND_CONTEXT)
  }

  async forkConversation(messageId: EntryId, userId: string) {
    const entry = await this.harness.commit(async tx => {
      return await tx.entry(messageId)
    }, BACKGROUND_CONTEXT)

    if (!entry) return null

    const parentConv = await this.harness.conversation(
      entry.conversationId,
      BACKGROUND_CONTEXT
    )
    if (!parentConv) return null

    const thread = await parentConv.fork(
      messageId,
      { ownership: { kind: 'ownerless' } },
      BACKGROUND_CONTEXT
    )

    // Build a title from the forked message content + parent chat name
    const parentRecord = await db
      .select({ title: userConversations.title })
      .from(userConversations)
      .where(eq(userConversations.conversationId, String(entry.conversationId)))
      .limit(1)
    const parentTitle = parentRecord[0]?.title ?? `Chat ${entry.conversationId}`

    let forkTitle: string
    const messageText = extractEntryText(entry.model)
    if (messageText) {
      const truncated =
        messageText.length > 30
          ? `${messageText.substring(0, 30)}...`
          : messageText
      forkTitle = `${truncated} (from ${parentTitle})`
    } else {
      forkTitle = `Fork: ${parentTitle}`
    }

    await db
      .insert(userConversations)
      .values({ conversationId: String(thread.id), userId, title: forkTitle })

    return {
      newConversationId: thread.id,
      parentConversationId: entry.conversationId,
    }
  }

  async getConversationStream(conversationId: ConversationId) {
    return await this.harness.conversation(conversationId, BACKGROUND_CONTEXT)
  }
}

/** Extract plain text from a pi-durable entry's model messages. */
function extractEntryText(
  model: ReadonlyArray<{ content?: unknown }> | undefined
): string {
  if (!model?.[0]?.content) return ''
  const content = model[0].content
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .filter(
        (c: { type?: string; text?: string; thinking?: string }) =>
          (c.type === 'text' && c.text) || (c.type === 'thinking' && c.thinking)
      )
      .map((c: { text?: string; thinking?: string }) => c.text || c.thinking)
      .join('')
  }
  return ''
}
