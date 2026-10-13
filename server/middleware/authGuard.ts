import { fromNodeHeaders } from 'better-auth/node'
import type { NextFunction, Request, Response } from 'express'
import type { auth as betterAuthInstance } from '../auth/auth.ts'

export function createAuthGuard(auth: typeof betterAuthInstance) {
  return async (req: Request, res: Response, next: NextFunction) => {
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
