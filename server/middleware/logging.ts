import { randomUUID } from 'node:crypto'
import type { RequestHandler } from 'express'
import { logger } from '../logger.ts'

export const requestLogging: RequestHandler = (req, res, next) => {
  const requestId = randomUUID()
  const started = performance.now()
  // Generate our own ID rather than logging an untrusted client header.
  res.setHeader('X-Request-ID', requestId)
  // Log the route template, not URLs containing queries or user-supplied IDs.
  const method = req.method
  let completed = false
  const record = (aborted: boolean) => {
    if (completed) return
    completed = true
    const route: unknown = req.route?.path
    const fields = {
      requestId,
      method,
      route: typeof route === 'string' ? route : 'unmatched',
      status: res.statusCode,
      durationMs: Math.round(performance.now() - started),
      aborted,
    }
    const level =
      res.statusCode >= 500
        ? 'error'
        : aborted || res.statusCode >= 400
          ? 'warn'
          : 'info'
    logger[level]('http.request', fields)
  }
  res.once('finish', () => record(false))
  res.once('close', () => record(!res.writableFinished))
  next()
}
