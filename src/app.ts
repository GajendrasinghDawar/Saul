import type { Harness } from '@earendil-works/pi-durable'
import { toNodeHandler } from 'better-auth/node'
import express from 'express'
import type { auth as betterAuthInstance } from './auth/auth.ts'
import { createAuthGuard } from './middleware/authGuard.ts'
import {
  apiLimiter,
  doubleCsrfProtection,
  generateCsrfToken,
  securityMiddleware,
} from './middleware/security.ts'
import { createChatRouter } from './routes/chat.ts'
import { createConversationsRouter } from './routes/conversations.ts'
import { createTasksRouter } from './routes/tasks.ts'
import { secretsRouter } from './routes/secrets.ts'

export type AppDependencies = {
  harness: Harness
  auth: typeof betterAuthInstance
  modelConfig: {
    providerName: string
    modelId: string
  }
}

import path from 'path'
import { fileURLToPath } from 'url'

export function createApp(dependencies: AppDependencies) {
  const { auth } = dependencies
  const app = express()

  // Security middleware
  app.use(securityMiddleware)

  // Better Auth handler - must be before CSRF
  app.use('/api/auth', toNodeHandler(auth))

  // Health check (no auth needed)
  app.get('/health', (_req, res) => res.json({ status: 'ok' }))

  // CSRF token endpoint (no auth needed)
  app.get('/csrf-token', (req, res) => {
    res.json({ csrfToken: generateCsrfToken(req, res) })
  })

  // Auth middleware - protects all remaining /api routes
  app.use('/api', createAuthGuard(auth))

  // Mount Feature Routes
  app.use(
    '/api',
    createChatRouter(dependencies, doubleCsrfProtection, apiLimiter)
  )
  app.use('/api/tasks', createTasksRouter(dependencies))
  app.use('/api/conversations', createConversationsRouter(dependencies))
  app.use('/api/secrets', secretsRouter)

  // Serve static files in production
  const __filename = fileURLToPath(import.meta.url)
  const __dirname = path.dirname(__filename)
  const publicPath = path.join(__dirname, '../../web/dist')
  
  app.use(express.static(publicPath))
  app.get('*', (req, res) => {
    if (!req.path.startsWith('/api')) {
      res.sendFile(path.join(publicPath, 'index.html'))
    } else {
      res.status(404).json({ error: 'Not found' })
    }
  })

  return app
}
