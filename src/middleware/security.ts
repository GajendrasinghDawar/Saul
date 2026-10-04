import cookieParser from 'cookie-parser'
import { doubleCsrf } from 'csrf-csrf'
import express from 'express'
import rateLimit from 'express-rate-limit'
import helmet from 'helmet'

export const securityMiddleware = [
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'https:'],
        connectSrc: ["'self'"],
      },
    },
  }),
  express.json({ limit: '10kb' }),
  cookieParser(process.env.COOKIE_SECRET || 'lali-secret'),
]


const csrfConfig = doubleCsrf({
  getSecret: () => {
    if (process.env.NODE_ENV === 'production' && !process.env.CSRF_SECRET) {
      throw new Error('CSRF_SECRET must be set in production')
    }
    return process.env.CSRF_SECRET || 'csrf-secret-dev-only'
  },
  getSessionIdentifier: (req: express.Request) => {
    return req.cookies?.['better-auth.session_token'] || 'unknown'
  },
  cookieName: 'x-csrf-token',
  cookieOptions: {
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
  },
})

export const doubleCsrfProtection = csrfConfig.doubleCsrfProtection
export const generateCsrfToken = csrfConfig.generateCsrfToken

export const apiLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10000 })
