import { fromNodeHeaders } from 'better-auth/node'
import { type ErrorRequestHandler, Router } from 'express'
import rateLimit from 'express-rate-limit'
import type { auth as betterAuthInstance } from '../auth/auth.ts'
import { cookieCsrfProtection } from '../middleware/security.ts'
import { AiError, type AiManager } from '../services/ai.ts'
import { AiLogins } from '../services/ai-logins.ts'

export function createAiRouter(
  auth: typeof betterAuthInstance,
  manager: AiManager
) {
  const router = Router()
  const logins = new AiLogins(manager)
  router.use((_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store')
    next()
  })
  router.use(async (req, res, next) => {
    try {
      const headers = fromNodeHeaders(req.headers)
      const authorization = headers.get('authorization')
      if (authorization !== null) {
        if (!/^Bearer \S+$/i.test(authorization))
          return res.status(401).json({ error: 'Authentication required' })
        headers.delete('cookie')
      }
      const session = await auth.api.getSession({
        headers,
        query: { disableCookieCache: true },
      })
      if (!session)
        return res.status(401).json({ error: 'Authentication required' })
      if (session.user.role !== 'admin')
        return res.status(403).json({ error: 'Administrator access required' })
      res.locals.userId = session.user.id
      if (!authorization && req.method !== 'GET')
        return cookieCsrfProtection(req, res, error => {
          if (error)
            return res.status(403).json({
              error: 'CSRF validation failed. Refresh the page and try again.',
            })
          next()
        })
      next()
    } catch {
      res.status(401).json({ error: 'Authentication required' })
    }
  })
  router.use(
    rateLimit({
      windowMs: 60_000,
      limit: 30,
      skip: req => req.method === 'GET',
      message: { error: 'Too many AI changes. Try again shortly.' },
    })
  )
  router.get('/', async (_req, res) => res.json(await manager.metadata()))
  router.get('/providers/:id/models', async (req, res) => {
    res.json({ models: await manager.catalog(req.params.id) })
  })
  router.put('/default', async (req, res) => {
    await manager.setDefault(req.body)
    res.json({ success: true })
  })
  router.put('/providers/azure/connection', async (req, res) => {
    logins.cancelProvider('azure')
    await manager.setAzure(req.body)
    res.json({ success: true })
  })
  router.put('/providers/:id', async (req, res) => {
    logins.cancelProvider(req.params.id)
    await manager.put(req.params.id, req.body)
    res.json({ success: true })
  })
  router.delete('/providers/:id', async (req, res) => {
    logins.cancelProvider(req.params.id)
    await manager.remove(req.params.id)
    res.json({ success: true })
  })
  router.delete('/providers/:id/credential', async (req, res) => {
    logins.cancelProvider(req.params.id)
    await manager.models.logout(req.params.id)
    res.json({ success: true })
  })
  router.post('/providers/:id/login', async (req, res) => {
    await manager.ensureConfig()
    res.json(
      logins.start(req.params.id, req.body?.method, String(res.locals.userId))
    )
  })
  router.get('/logins/:id', (req, res) =>
    res.json(logins.get(req.params.id, String(res.locals.userId)))
  )
  router.post('/logins/:id/answer', (req, res) =>
    res.json(
      logins.answer(
        req.params.id,
        String(res.locals.userId),
        req.body?.promptId,
        req.body?.value
      )
    )
  )
  router.delete('/logins/:id', (req, res) => {
    logins.cancel(req.params.id, String(res.locals.userId))
    res.json({ success: true })
  })
  const errors: ErrorRequestHandler = (error: unknown, _req, res, _next) => {
    res.status(error instanceof AiError ? 400 : 503).json({
      error:
        error instanceof AiError
          ? error.message
          : 'AI management is unavailable. Check server configuration.',
    })
  }
  router.use(errors)
  return router
}
