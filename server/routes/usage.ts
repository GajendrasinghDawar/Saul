import { Router } from 'express'
import type { AppDependencies } from '../app.ts'
import { UsageService } from '../services/usage.ts'

export function createUsageRouter(dependencies: AppDependencies) {
  const router = Router()
  const service = new UsageService(dependencies.harness)
  router.get('/', async (_req, res) => {
    res.setHeader('Cache-Control', 'no-store')
    try {
      res.json(await service.getOverview(String(res.locals.userId)))
    } catch {
      res.status(500).json({ error: 'Unable to load usage overview' })
    }
  })
  return router
}
