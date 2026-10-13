import './setup/settings.ts'
import { createApp } from './app.ts'
import { auth } from './auth/auth.ts'
import { getSecret } from './secretsManager.ts'
import { setupAiModel } from './setup/ai.ts'
import { setupAttachments } from './setup/attachments.ts'
import { setupDurableHarness } from './setup/durable.ts'

async function startServer() {
  const { models, providerName, modelId } = setupAiModel()
  const attachments = setupAttachments()
  const harness = await setupDurableHarness(models, attachments)

  const app = createApp({
    harness,
    auth,
    attachments,
    models,
    modelConfig: { providerName, modelId },
  })

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
