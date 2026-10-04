import dotenv from 'dotenv'
import { createApp } from './app.ts'
import { auth } from './auth/auth.ts'
import { setupAiModel } from './setup/ai.ts'
import { setupDurableHarness } from './setup/durable.ts'
import { validateEnvironment } from './setup/env.ts'

dotenv.config({ override: true })

async function startServer() {
  // 1. Validate environment before doing anything else
  validateEnvironment()

  const { models, providerName, modelId } = setupAiModel()
  const harness = await setupDurableHarness(models)

  const app = createApp({
    harness,
    auth,
    modelConfig: { providerName, modelId },
  })

  const port = process.env.PORT || 3000

  app.listen(port, () => {
    console.log(`Saul, is Server running at http://localhost:${port}`)
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
