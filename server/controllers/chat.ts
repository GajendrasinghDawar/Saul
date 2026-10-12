import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import type { ConversationId, EntryId } from '@earendil-works/pi-durable'
import type { Request, Response } from 'express'
import { isConversationOwner } from '../agent/data.ts'
import type { AppDependencies } from '../app.ts'
import { ChatService } from '../services/chat.ts'

export function createChatController({
  harness,
  modelConfig,
}: AppDependencies) {
  const chatService = new ChatService(
    harness,
    modelConfig.providerName,
    modelConfig.modelId
  )

  return {
    async submitMessage(req: Request, res: Response) {
      const { message, conversationId, whenBusy } = req.body
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

      const settled = await chatService.submitMessage(
        targetConvId,
        message,
        whenBusy
      )

      if (!settled) {
        return res.status(404).json({ error: 'Conversation not found' })
      }

      res.json({ success: true, result: settled })
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
