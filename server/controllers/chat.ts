import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import {
  ConversationBusy,
  type ConversationId,
  type EntryId,
} from '@earendil-works/pi-durable'
import { asc, eq } from 'drizzle-orm'
import type { Request, Response } from 'express'
import { isConversationOwner } from '../agent/data.ts'
import type { AppDependencies } from '../app.ts'
import { db } from '../db/index.ts'
import { userConversations } from '../db/schema.ts'
import { AiError } from '../services/ai.ts'
import { AttachmentError } from '../services/attachments.ts'
import { ChatService } from '../services/chat.ts'
import { resolveReply, searchHistory } from '../services/chat-history.ts'

export function createChatController({
  harness,
  attachments,
  models,
  ai,
}: AppDependencies) {
  const chatService = new ChatService(harness, ai.newConversationModel)

  return {
    async submitMessage(req: Request, res: Response) {
      const {
        message,
        conversationId,
        whenBusy,
        attachmentIds = [],
        requestId,
        replyToEntryId,
      } = req.body ?? {}
      if (
        replyToEntryId !== undefined &&
        (typeof replyToEntryId !== 'number' ||
          !Number.isSafeInteger(replyToEntryId) ||
          replyToEntryId < 1 ||
          !conversationId)
      ) {
        return res.status(400).json({
          error:
            'Replies require a canonical entry ID and target conversation ID.',
        })
      }
      if (
        conversationId !== undefined &&
        (!Number.isSafeInteger(Number(conversationId)) ||
          Number(conversationId) < 1)
      ) {
        return res.status(400).json({ error: 'Invalid conversation ID.' })
      }
      if (
        requestId !== undefined &&
        (typeof requestId !== 'string' ||
          !/^[A-Za-z0-9_-]{1,128}$/.test(requestId))
      ) {
        return res.status(400).json({ error: 'Invalid submission ID.' })
      }
      if (
        typeof message !== 'string' ||
        !Array.isArray(attachmentIds) ||
        !attachmentIds.every((id: unknown) => typeof id === 'string') ||
        (!message.trim() && attachmentIds.length === 0)
      ) {
        return res.status(400).json({ error: 'Send text or attachment IDs.' })
      }
      if (
        whenBusy !== undefined &&
        !['followUp', 'reject', 'steer'].includes(whenBusy)
      ) {
        return res.status(400).json({ error: 'Invalid busy-message policy.' })
      }
      const userId = res.locals.userId

      let targetConvId = conversationId as ConversationId | undefined
      if (!targetConvId) {
        try {
          targetConvId = await chatService.getOrCreateMainConversationId(userId)
        } catch {
          return res.status(409).json({
            error:
              'No default AI model is available. Ask an administrator to configure one.',
          })
        }
      } else {
        targetConvId = Number(targetConvId) as ConversationId
        if (!(await isConversationOwner(String(targetConvId), userId))) {
          return res
            .status(403)
            .json({ error: 'Forbidden: Not conversation owner' })
        }
      }

      try {
        const conv = await harness.conversation(
          targetConvId,
          BACKGROUND_CONTEXT
        )
        if (!conv)
          return res.status(404).json({ error: 'Conversation not found' })
        // Ownership is already checked. Retry the original admitted submission,
        // even if a later request body names a different reply or attachment.
        if (requestId) {
          const original = await chatService.existingSubmission(
            targetConvId,
            requestId
          )
          if (original)
            return res.json({
              success: true,
              result: await original.wait(BACKGROUND_CONTEXT),
            })
        }
        const reply =
          replyToEntryId === undefined
            ? undefined
            : await resolveReply(harness, targetConvId, replyToEntryId)
        if (replyToEntryId !== undefined && !reply) {
          return res.status(404).json({
            error: 'Referenced message is not visible in this conversation.',
          })
        }
        const agent = await conv.agent(BACKGROUND_CONTEXT)
        const ref = agent.model
        const model = ref
          ? models.getModel(ref.provider, ref.modelId)
          : undefined
        if (!model)
          return res.status(409).json({
            error:
              'This conversation model is unavailable. Ask an administrator to restore the provider and model.',
          })
        const files = await attachments.prepare(
          String(userId),
          attachmentIds,
          model.input.includes('image')
        )
        const settled = await chatService.submitMessage(
          targetConvId,
          message,
          whenBusy,
          files,
          requestId,
          reply
        )
        if (!settled)
          return res.status(404).json({ error: 'Conversation not found' })
        res.json({ success: true, result: settled })
      } catch (error) {
        if (error instanceof AiError)
          return res.status(409).json({ error: error.message })
        if (error instanceof AttachmentError)
          return res.status(error.status).json({ error: error.message })
        if (error instanceof ConversationBusy)
          return res.status(409).json({
            error: 'The agent is busy. Wait for the response before sending.',
          })
        res.status(500).json({
          error:
            'Could not confirm message delivery. Check the transcript before retrying.',
        })
      }
    },

    async search(req: Request, res: Response) {
      const q = req.query.q
      const cursor = req.query.cursor
      if (
        typeof q !== 'string' ||
        !q.trim() ||
        q.length > 200 ||
        (cursor !== undefined &&
          (typeof cursor !== 'string' ||
            cursor.length > 100 ||
            !/^\d+:\d*$/.test(cursor)))
      ) {
        return res.status(400).json({
          error: 'Use a search query of 1–200 characters and a valid cursor.',
        })
      }
      const conversations = await db
        .select({
          conversationId: userConversations.conversationId,
          title: userConversations.title,
        })
        .from(userConversations)
        .where(eq(userConversations.userId, String(res.locals.userId)))
        .orderBy(asc(userConversations.conversationId))
      res.setHeader('Cache-Control', 'no-store')
      try {
        return res.json(
          await searchHistory(harness, conversations, q.trim(), cursor)
        )
      } catch (error) {
        if (
          error instanceof Error &&
          error.message === 'Invalid search cursor.'
        )
          return res.status(400).json({ error: error.message })
        return res.status(500).json({ error: 'Could not search history.' })
      }
    },

    async sourceMessage(req: Request, res: Response) {
      const conversationId = Number(req.params.conversationId) as ConversationId
      const entryId = Number(req.params.entryId)
      res.setHeader('Cache-Control', 'no-store')
      if (
        !Number.isSafeInteger(conversationId) ||
        conversationId < 1 ||
        !Number.isSafeInteger(entryId) ||
        entryId < 1
      )
        return res.status(400).json({ error: 'Invalid source message.' })
      if (
        !(await isConversationOwner(String(conversationId), res.locals.userId))
      )
        return res.status(404).json({ error: 'Source message is unavailable.' })
      const message = await resolveReply(harness, conversationId, entryId)
      if (!message)
        return res.status(404).json({ error: 'Source message is unavailable.' })
      return res.json({ message })
    },

    async newThread(_req: Request, res: Response) {
      const userId = res.locals.userId
      try {
        const conversationId = await chatService.createConversation(userId)
        res.json({ success: true, conversationId })
      } catch {
        res.status(409).json({
          error:
            'No default AI model is available. Ask an administrator to configure one.',
        })
      }
    },

    async forkThread(req: Request, res: Response) {
      const messageIdNum = Number(req.params.messageId) as EntryId
      const userId = res.locals.userId

      const forked = await chatService.forkConversation(messageIdNum, userId)
      if (forked === 'forbidden') {
        return res
          .status(403)
          .json({ error: 'Forbidden: Not conversation owner' })
      }
      if (!forked) {
        return res
          .status(404)
          .json({ error: 'Message or parent conversation not found' })
      }

      res.json({ success: true, newConversationId: forked.newConversationId })
    },

    async streamConversation(req: Request, res: Response) {
      const userId = res.locals.userId
      let targetConvId = req.query.conversationId as unknown as
        | ConversationId
        | undefined

      if (!targetConvId) {
        try {
          targetConvId = await chatService.getOrCreateMainConversationId(userId)
        } catch {
          return res.status(409).json({
            error:
              'No default AI model is available. Ask an administrator to configure one.',
          })
        }
      } else {
        targetConvId = Number(targetConvId) as ConversationId
        if (!(await isConversationOwner(String(targetConvId), userId))) {
          return res.status(403).send('Forbidden: Not conversation owner')
        }
      }

      res.setHeader('Content-Type', 'text/event-stream')
      res.setHeader('Cache-Control', 'no-cache, no-transform')
      res.setHeader('Connection', 'keep-alive')
      res.setHeader('X-Accel-Buffering', 'no')
      res.flushHeaders()

      const writeEvent = (event: unknown) => {
        res.write(`data: ${JSON.stringify(event)}\n\n`)
        const flush = Reflect.get(res, 'flush')
        if (typeof flush === 'function') Reflect.apply(flush, res, [])
      }

      const conv = await chatService.getConversationStream(targetConvId)
      if (!conv) {
        writeEvent({ error: 'Not found' })
        res.end()
        return
      }

      const view = await conv.viewState(BACKGROUND_CONTEXT)
      writeEvent({
        type: 'init',
        conversationId: String(conv.id),
        view: view.value,
      })

      const unsubscribe = view.subscribe(value => {
        writeEvent({
          type: 'update',
          conversationId: String(conv.id),
          view: value,
        })
      })

      req.on('close', () => {
        unsubscribe()
      })
    },
  }
}
