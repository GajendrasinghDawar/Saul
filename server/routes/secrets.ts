import { fromNodeHeaders } from 'better-auth/node'
import { eq } from 'drizzle-orm'
import { Router } from 'express'
import rateLimit from 'express-rate-limit'
import type { auth as betterAuthInstance } from '../auth/auth.ts'
import { db } from '../db/index.ts'
import { secrets } from '../db/schema.ts'
import { cookieCsrfProtection } from '../middleware/security.ts'
import {
  deleteSecretCache,
  encryptSetting,
  isSettingName,
  settingDefinitions,
  settingStatus,
  updateSecretCache,
  validateSettingValue,
} from '../secretsManager.ts'

export function createSecretsRouter(auth: typeof betterAuthInstance) {
  const router = Router()
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
        // Authenticate bearer alone. A cookie must never rescue an invalid bearer.
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
      res.locals.settingsHeaders = headers
      res.locals.userId = session.user.id
      if (!authorization && req.method !== 'GET') {
        return cookieCsrfProtection(req, res, error => {
          if (error)
            return res.status(403).json({
              error: 'CSRF validation failed. Refresh the page and try again.',
            })
          next()
        })
      }
      next()
    } catch {
      res.status(401).json({ error: 'Authentication required' })
    }
  })
  router.use(
    rateLimit({
      windowMs: 60_000,
      limit: 20,
      message: { error: 'Too many settings requests. Try again later.' },
    })
  )
  router.get('/', (_req, res) => {
    res.json(
      Object.keys(settingDefinitions).filter(isSettingName).map(settingStatus)
    )
  })
  router.post('/', async (req, res) => {
    const name: unknown = req.body?.name
    const value: unknown = req.body?.value
    if (!isSettingName(name))
      return res.status(400).json({ error: 'Unsupported setting' })
    if (!validateSettingValue(name, value))
      return res.status(400).json({ error: 'Invalid setting value' })
    let encrypted: string
    try {
      encrypted = encryptSetting(name, value)
    } catch {
      return res.status(503).json({
        error:
          'Settings encryption is unavailable. Configure SAUL_SECRETS_KEY.',
      })
    }
    try {
      const row = {
        name,
        value: encrypted,
        kind: settingDefinitions[name].kind,
        allowedHosts: null,
        updatedAt: new Date(),
        updatedBy: String(res.locals.userId),
      }
      await db
        .insert(secrets)
        .values(row)
        .onConflictDoUpdate({ target: secrets.name, set: row })
      updateSecretCache(name, value)
      const { applyMode, pendingRestart } = settingStatus(name)
      res.json({ success: true, applyMode, pendingRestart })
    } catch {
      res.status(500).json({ error: 'Failed to save setting' })
    }
  })
  router.delete('/:name', async (req, res) => {
    const name = req.params.name
    if (!isSettingName(name))
      return res.status(400).json({ error: 'Unsupported setting' })
    const password: unknown = req.body?.password
    if (typeof password !== 'string' || !password || password.length > 256)
      return res.status(400).json({ error: 'Current password required' })
    try {
      const verified = await auth.api.verifyPassword({
        headers: res.locals.settingsHeaders,
        body: { password },
      })
      if (!verified.status)
        return res.status(403).json({ error: 'Password verification failed' })
    } catch {
      return res.status(403).json({ error: 'Password verification failed' })
    }
    try {
      await db.delete(secrets).where(eq(secrets.name, name))
      deleteSecretCache(name)
      const { applyMode, pendingRestart } = settingStatus(name)
      res.json({ success: true, applyMode, pendingRestart })
    } catch {
      res.status(500).json({ error: 'Failed to reset setting' })
    }
  })
  return router
}
