import { fromNodeHeaders } from 'better-auth/node'
import type { NextFunction, Request, Response } from 'express'
import type { auth as betterAuthInstance } from '../auth/auth.ts'

export function createAuthGuard(auth: typeof betterAuthInstance) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const session = await auth.api.getSession({
        headers: fromNodeHeaders(req.headers),
      })

      if (!session) {
        return res
          .status(401)
          .json({ error: 'ERR_UNAUTH', message: 'Authentication required' })
      }

      res.locals.userId = session.user.id
      next()
    } catch {
      return res
        .status(500)
        .json({ error: 'ERR_AUTH', message: 'Auth check failed' })
    }
  }
}
