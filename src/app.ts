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
import { secretsRouter } from './routes/secrets.ts'
import { createTasksRouter } from './routes/tasks.ts'

export type AppDependencies = {
  harness: Harness
  auth: typeof betterAuthInstance
  modelConfig: {
    providerName: string
    modelId: string
  }
}

import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { db } from './db/index.ts'
import { user } from './db/schema.ts'

export function createApp(dependencies: AppDependencies) {
  const { auth } = dependencies
  const app = express()
  app.set('trust proxy', 1) // Trust Caddy reverse proxy for rate limiting and IPs

  // Security middleware
  app.use(securityMiddleware)

  // First User / Admin-only setup lock
  app.use('/api/auth/sign-up/email', async (req, res, next) => {
    try {
      const existingUsers = await db.select().from(user).limit(1)
      if (existingUsers.length === 0) {
        // Automatically make the first user an admin
        if (req.body) req.body.role = 'admin'
        return next() // Allowed: this is the very first user being created
      }

      // If users exist, only allow if the requester has an active admin session
      const session = await auth.api.getSession({
        headers: new Headers(req.headers as Record<string, string>),
      })
      if (session?.user.role !== 'admin') {
        return res.status(403).json({
          error: 'Setup complete. Only administrators can register new users.',
        })
      }
      next()
    } catch (error) {
      next(error)
    }
  })

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
