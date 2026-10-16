import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import type { Models } from '@earendil-works/pi-ai'
import type { ConversationId, Harness } from '@earendil-works/pi-durable'
import { fromNodeHeaders, toNodeHandler } from 'better-auth/node'
import express, { type ErrorRequestHandler } from 'express'
import { isConversationOwner } from './agent/data.ts'
import type { auth as betterAuthInstance } from './auth/auth.ts'
import { createAuthGuard } from './middleware/authGuard.ts'
import { requestLogging } from './middleware/logging.ts'
import {
  apiLimiter,
  doubleCsrfProtection,
  generateCsrfToken,
  securityMiddleware,
} from './middleware/security.ts'
import { createAiRouter } from './routes/ai.ts'
import { createArtifactsRouter } from './routes/artifacts.ts'
import { createChatRouter } from './routes/chat.ts'
import { createConversationsRouter } from './routes/conversations.ts'
import { createTasksRouter } from './routes/tasks.ts'
import { createUsageRouter } from './routes/usage.ts'
import type { AiManager } from './services/ai.ts'
import type { AttachmentStore } from './services/attachments.ts'
import { AttachmentError } from './services/attachments.ts'

export type AppDependencies = {
  harness: Harness
  auth: typeof betterAuthInstance
  attachments: AttachmentStore
  models: Models
  ai: AiManager
}

import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { db } from './db/index.ts'
import { user } from './db/schema.ts'

export function createApp(dependencies: AppDependencies) {
  const { auth } = dependencies
  const app = express()
  app.set('trust proxy', 1) // Trust Caddy reverse proxy for rate limiting and IPs

  app.use(requestLogging)

  // Security middleware
  app.use(securityMiddleware)

  const settingsBodyError: ErrorRequestHandler = (_error, _req, res, _next) => {
    res.setHeader('Cache-Control', 'no-store')
    res.status(400).json({ error: 'Invalid settings request body' })
  }
  app.use('/api/ai', settingsBodyError)

  const authHandler = toNodeHandler(auth)
  let signupPending = Promise.resolve()
  // Serialize registration through completion so two first requests cannot
  // both observe an empty database. Saul runs one backend instance.
  app.use('/api/auth/sign-up/email', async (req, res, next) => {
    const previous = signupPending
    let release = () => {}
    signupPending = new Promise<void>(resolve => {
      release = resolve
    })
    await previous
    try {
      const existingUsers = await db.select().from(user).limit(1)
      if (existingUsers.length > 0) {
        const session = await auth.api.getSession({
          headers: fromNodeHeaders(req.headers),
        })
        if (session?.user.role !== 'admin') {
          return res.status(403).json({
            error:
              'Setup complete. Only administrators can register new users.',
          })
        }
      }
      await authHandler(req, res)
    } catch (error) {
      next(error)
    } finally {
      release()
    }
  })

  // Better Auth handler - must be before CSRF
  app.use('/api/auth', authHandler)

  // Health check (no auth needed)
  app.get('/health', (_req, res) => res.json({ status: 'ok' }))

  // CSRF token endpoint (no auth needed)
  app.get('/csrf-token', (req, res) => {
    res.json({ csrfToken: generateCsrfToken(req, res) })
  })

  // Settings authenticate bearer and cookie requests separately before CSRF.
  app.use('/api/ai', createAiRouter(auth, dependencies.ai))

  // Auth middleware - protects all remaining /api routes
  app.use('/api', createAuthGuard(auth))

  // Mount Feature Routes
  app.use('/api/usage', createUsageRouter(dependencies))
  app.use(
    '/api/artifacts',
    createArtifactsRouter(
      dependencies.attachments,
      async (req, res) => {
        if (req.query.conversationId === undefined) {
          const ref = dependencies.ai.getDefault()
          return Boolean(
            ref &&
              dependencies.models
                .getModel(ref.provider, ref.modelId)
                ?.input.includes('image')
          )
        }
        const id = Number(req.query.conversationId)
        if (!Number.isSafeInteger(id) || id < 1)
          throw new AttachmentError(400, 'Invalid conversation ID.')
        if (!(await isConversationOwner(String(id), String(res.locals.userId))))
          throw new AttachmentError(403, 'Conversation access denied.')
        const conv = await dependencies.harness.conversation(
          id as ConversationId,
          BACKGROUND_CONTEXT
        )
        const agent = await conv?.agent(BACKGROUND_CONTEXT)
        const ref = agent?.model
        const model =
          ref && dependencies.models.getModel(ref.provider, ref.modelId)
        if (!model)
          throw new AttachmentError(
            409,
            'This conversation model is unavailable.'
          )
        return model.input.includes('image')
      },
      doubleCsrfProtection
    )
  )
  app.use(
    '/api',
    createChatRouter(dependencies, doubleCsrfProtection, apiLimiter)
  )
  app.use('/api/tasks', doubleCsrfProtection, createTasksRouter(dependencies))
  app.use('/api/conversations', createConversationsRouter(dependencies))

  // Serve static files in production
  const __filename = fileURLToPath(import.meta.url)
  const __dirname = path.dirname(__filename)
  const publicPath = path.join(__dirname, '../web/dist')

  app.use(express.static(publicPath))
  app.use((req, res, _next) => {
    if (!req.path.startsWith('/api')) {
      res.sendFile(path.join(publicPath, 'index.html'))
    } else {
      res.status(404).json({ error: 'Not found' })
    }
  })

  return app
}
