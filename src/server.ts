import dotenv from 'dotenv'
import { createApp } from './app.ts'
import { auth, checkAuthHealth, checkDbHealth } from './auth/auth.ts'
import { setupAiModel } from './setup/ai.ts'
import { setupDurableHarness } from './setup/durable.ts'

dotenv.config({ override: true })

async function startServer() {
  const { models, providerName, modelId } = setupAiModel()
  const harness = await setupDurableHarness(models)

  const app = createApp({
    harness,
    auth,
    modelConfig: { providerName, modelId },
  })

  // Health check (no auth needed)
  app.get('/health', (_req, res) => {
    const authH = checkAuthHealth()
    if (authH.status !== 'ok') return res.status(503).json(authH)
    const dbH = checkDbHealth()
    if (dbH.status !== 'ok') return res.status(503).json(dbH)
    res.json({ status: 'ok' })
  })

  const port = process.env.PORT || 3000
  app.listen(port, () => {
    console.log(`🚀 Lali Server running at http://localhost:${port}`)
  })
}

startServer().catch(err => {
  console.error('Failed to start server', err)
  process.exit(1)
})

// Prevent random uncaught network errors from crashing the server
process.on('uncaughtException', err => {
  console.error('Uncaught Exception:', err)
  process.exit(1)
})
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason)
  process.exit(1)
})
