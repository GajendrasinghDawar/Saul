import { type RequestHandler, Router } from 'express'
import type { AppDependencies } from '../app.ts'
import { createChatController } from '../controllers/chat.ts'

export function createChatRouter(
  dependencies: AppDependencies,
  csrf: RequestHandler,
  limiter: RequestHandler
) {
  const router = Router()
  const controller = createChatController(dependencies)

  // Chat: Submit message to a conversation
  router.post('/chat', csrf, limiter, controller.submitMessage)

  // Create new conversation
  router.post('/new-thread', csrf, limiter, controller.newThread)

  // Fork conversation from a specific message
  router.post('/fork/:messageId', csrf, limiter, controller.forkThread)

  // SSE Stream - watch the agent live
  router.get('/stream', controller.streamConversation)

  return router
}
