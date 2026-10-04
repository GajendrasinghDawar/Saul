import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import {
  type ConversationId,
  configure,
  type EntryId,
  type Harness,
} from '@earendil-works/pi-durable'
import { eq } from 'drizzle-orm'
import { type RequestHandler, Router } from 'express'
import { isConversationOwner } from '../agent/data.ts'
import { ReminderExtension } from '../agent/reminders.ts'
import { SubagentExtension } from '../agent/subagents/tool.ts'
import { LaliExtension } from '../agent/tools.ts'
import type { AppDependencies } from '../app.ts'
import { db } from '../db/index.ts'
import { userConversations } from '../db/schema.ts'

async function getOrCreateMainConversationId(
  userId: string,
  harness: Harness,
  providerName: string,
  modelId: string
): Promise<ConversationId> {
  const records = await db
    .select()
    .from(userConversations)
    .where(eq(userConversations.userId, userId))
    .limit(1) // Just grab the first one they ever made

  if (records.length > 0) {
    return Number(records[0].conversationId) as ConversationId
  }

  // Create one if none exists
  const convRecord = await harness.commit(async tx => {
    return tx.createConversation({ ownership: { kind: 'ownerless' } })
  }, BACKGROUND_CONTEXT)

  await harness.commit(async tx => {
    await configure(tx, convRecord.id, {
      model: { provider: providerName, modelId },
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

export function createChatRouter(
  { harness, modelConfig }: AppDependencies,
  csrf: RequestHandler,
  limiter: RequestHandler
) {
  const router = Router()
  const { providerName, modelId } = modelConfig

  // Chat: Submit message to a conversation
  router.post('/chat', csrf, limiter, async (req, res) => {
    const { message, conversationId, whenBusy } = req.body
    const userId = res.locals.userId

    let targetConvId = conversationId as ConversationId | undefined
    if (!targetConvId) {
      targetConvId = await getOrCreateMainConversationId(
        userId,
        harness,
        providerName,
        modelId
      )
    } else {
      targetConvId = Number(targetConvId) as ConversationId
      if (!(await isConversationOwner(String(targetConvId), userId))) {
        return res
          .status(403)
          .json({ error: 'Forbidden: Not conversation owner' })
      }
    }

    const conv = await harness.conversation(targetConvId, BACKGROUND_CONTEXT)
    if (!conv) return res.status(404).json({ error: 'Conversation not found' })

    const submission = await conv.submit(
      { type: 'input', content: message, whenBusy },
      BACKGROUND_CONTEXT
    )
    const settled = await submission.wait(BACKGROUND_CONTEXT)

    res.json({ success: true, result: settled })
  })

  // Create new conversation
  router.post('/new-thread', csrf, limiter, async (_req, res) => {
    const userId = res.locals.userId
    const convRecord = await harness.commit(async tx => {
      return tx.createConversation({ ownership: { kind: 'ownerless' } })
    }, BACKGROUND_CONTEXT)

    await harness.commit(async tx => {
      await configure(tx, convRecord.id, {
        model: { provider: providerName, modelId },
        extensions: {
          add: [LaliExtension, SubagentExtension, ReminderExtension],
        },
      })
    }, BACKGROUND_CONTEXT)

    await db
      .insert(userConversations)
      .values({ conversationId: String(convRecord.id), userId })

    res.json({ success: true, conversationId: convRecord.id })
  })

  // Fork conversation from a specific message
  router.post('/fork/:messageId', csrf, limiter, async (req, res) => {
    const messageIdNum = Number(req.params.messageId) as EntryId
    const userId = res.locals.userId

    const entry = await harness.commit(async tx => {
      return await tx.entry(messageIdNum)
    }, BACKGROUND_CONTEXT)

    if (!entry) return res.status(404).json({ error: 'Message not found' })

    if (!(await isConversationOwner(String(entry.conversationId), userId))) {
      return res
        .status(403)
        .json({ error: 'Forbidden: Not conversation owner' })
    }

    const parentConv = await harness.conversation(
      entry.conversationId,
      BACKGROUND_CONTEXT
    )
    if (!parentConv)
      return res.status(404).json({ error: 'Parent conversation not found' })

    const thread = await parentConv.fork(
      messageIdNum,
      { ownership: { kind: 'ownerless' } },
      BACKGROUND_CONTEXT
    )

    await db
      .insert(userConversations)
      .values({ conversationId: String(thread.id), userId })

    res.json({ success: true, newConversationId: thread.id })
  })

  // SSE Stream - watch the agent live
  router.get('/stream', async (req, res) => {
    const userId = res.locals.userId
    let targetConvId = req.query.conversationId as unknown as
      | ConversationId
      | undefined

    if (!targetConvId) {
      targetConvId = await getOrCreateMainConversationId(
        userId,
        harness,
        providerName,
        modelId
      )
    } else {
      targetConvId = Number(targetConvId) as ConversationId
      if (!(await isConversationOwner(String(targetConvId), userId))) {
        return res.status(403).send('Forbidden: Not conversation owner')
      }
    }

    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')
    res.flushHeaders()

    const conv = await harness.conversation(targetConvId, BACKGROUND_CONTEXT)
    if (!conv) {
      res.write(`data: ${JSON.stringify({ error: 'Not found' })}\n\n`)
      res.end()
      return
    }

    const view = await conv.viewState(BACKGROUND_CONTEXT)
    res.write(`data: ${JSON.stringify({ type: 'init', view: view.value })}\n\n`)

    const unsubscribe = view.subscribe(value => {
      res.write(`data: ${JSON.stringify({ type: 'update', view: value })}\n\n`)
    })

    req.on('close', () => {
      unsubscribe()
    })
  })

  return router
}
