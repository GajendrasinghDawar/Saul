import dotenv from 'dotenv'
import { setupDurableHarness } from './setup/durable.ts'
import { loadSecrets } from './secretsManager.ts'

dotenv.config({ override: true })

async function startServer() {
  await loadSecrets()

  const { validateEnvironment } = await import('./setup/env.ts')
  validateEnvironment()

  const { setupAiModel } = await import('./setup/ai.ts')
  const { auth } = await import('./auth/auth.ts')
  const { createApp } = await import('./app.ts')

  const { models, providerName, modelId } = setupAiModel()
  const harness = await setupDurableHarness(models)

  const app = createApp({
    harness,
    auth,
    modelConfig: { providerName, modelId },
  })

  const { getSecret } = await import('./secretsManager.ts')
  const port = getSecret('PORT', '3000')

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
