import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import {
  ConversationBusy,
  type ConversationId,
  type EntryId,
} from '@earendil-works/pi-durable'
import type { Request, Response } from 'express'
import { isConversationOwner } from '../agent/data.ts'
import type { AppDependencies } from '../app.ts'
import { AttachmentError } from '../services/attachments.ts'
import { ChatService } from '../services/chat.ts'

export function createChatController({
  harness,
  modelConfig,
  attachments,
  models,
}: AppDependencies) {
  const chatService = new ChatService(
    harness,
    modelConfig.providerName,
    modelConfig.modelId
  )

  return {
    async submitMessage(req: Request, res: Response) {
      const {
        message,
        conversationId,
        whenBusy,
        attachmentIds = [],
      } = req.body ?? {}
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
        targetConvId = await chatService.getOrCreateMainConversationId(userId)
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
        const agent = await conv.agent(BACKGROUND_CONTEXT)
        const ref = agent.model
        const model = ref
          ? models.getModel(ref.provider, ref.modelId)
          : undefined
        const files = await attachments.prepare(
          String(userId),
          attachmentIds,
          Boolean(model?.input.includes('image'))
        )
        const settled = await chatService.submitMessage(
          targetConvId,
          message,
          whenBusy,
          files
        )
        if (!settled)
          return res.status(404).json({ error: 'Conversation not found' })
        res.json({ success: true, result: settled })
      } catch (error) {
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

    async newThread(_req: Request, res: Response) {
      const userId = res.locals.userId
      const conversationId = await chatService.createConversation(userId)
      res.json({ success: true, conversationId })
    },

    async forkThread(req: Request, res: Response) {
      const messageIdNum = Number(req.params.messageId) as EntryId
      const userId = res.locals.userId

      const forked = await chatService.forkConversation(messageIdNum, userId)
      if (!forked) {
        return res
          .status(404)
          .json({ error: 'Message or parent conversation not found' })
      }

      if (
        !(await isConversationOwner(
          String(forked.parentConversationId),
          userId
        ))
      ) {
        return res
          .status(403)
          .json({ error: 'Forbidden: Not conversation owner' })
      }

      res.json({ success: true, newConversationId: forked.newConversationId })
    },

    async streamConversation(req: Request, res: Response) {
      const userId = res.locals.userId
      let targetConvId = req.query.conversationId as unknown as
        | ConversationId
        | undefined

      if (!targetConvId) {
        targetConvId = await chatService.getOrCreateMainConversationId(userId)
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
      writeEvent({ type: 'init', view: view.value })

      const unsubscribe = view.subscribe(value => {
        writeEvent({ type: 'update', view: value })
      })

      req.on('close', () => {
        unsubscribe()
      })
    },
  }
}
