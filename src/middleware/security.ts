import cookieParser from 'cookie-parser'
import { doubleCsrf } from 'csrf-csrf'
import express from 'express'
import rateLimit from 'express-rate-limit'
import helmet from 'helmet'

import { getSecret } from '../secretsManager.ts'

export const securityMiddleware = [
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'https:'],
        connectSrc: ["'self'"],
        upgradeInsecureRequests: null,
      },
    },
  }),
  express.json({ limit: '2mb' }), // 2mb allows for reasonable AI prompts and images
  cookieParser(getSecret('COOKIE_SECRET')), // Safe because env.ts validates this at boot
]

const csrfConfig = doubleCsrf({
  getSecret: () => getSecret('CSRF_SECRET', ''), // Safe because env.ts validates this at boot
  getSessionIdentifier: (req: express.Request) => {
    // Better-auth uses __Secure- prefix in production
    return (
      req.cookies?.['better-auth.session_token'] ||
      req.cookies?.['__Secure-better-auth.session_token'] ||
      'unknown'
    )
  },
  cookieName: 'x-csrf-token',
  cookieOptions: {
    sameSite: 'lax' as const,
    secure: getSecret('NODE_ENV') === 'production',
  },
})

export const doubleCsrfProtection = csrfConfig.doubleCsrfProtection
export const generateCsrfToken = csrfConfig.generateCsrfToken

// Global rate limiting (feature-specific routes can define stricter limits)
export const apiLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 2000 })
