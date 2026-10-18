import './setup/settings.ts'
import { createApp } from './app.ts'
import { auth } from './auth/auth.ts'
import { errorCategory, logger } from './logger.ts'
import { getSecret } from './secretsManager.ts'
import { setupAiModel } from './setup/ai.ts'
import { setupAttachments } from './setup/attachments.ts'
import { setupDurableHarness } from './setup/durable.ts'

async function startServer() {
  const ai = await setupAiModel()
  const { models } = ai
  const attachments = setupAttachments()
  const harness = await setupDurableHarness(models, attachments)
  // A failed storage closes Pi permanently. Exit so the process supervisor can
  // reopen it from durable state; never keep serving with a dead harness.
  void harness.closed.then(end => {
    if (end.reason === 'failed') {
      logger.error('durable.failed', { category: errorCategory(end.error) })
      process.exit(1)
    }
  })

  const app = createApp({
    harness,
    auth,
    attachments,
    models,
    ai,
  })

  const port = getSecret('PORT', '3000')

  app.listen(port, () => {
    logger.info('server.listening', {
      port,
      provider: ai.getDefault()?.provider,
      model: ai.getDefault()?.modelId,
    })
  })
}

startServer().catch(err => {
  logger.error('server.start_failed', { category: errorCategory(err) })
  process.exit(1)
})

// Prevent random uncaught network errors from crashing the server
process.on('uncaughtException', err => {
  logger.error('process.uncaught_exception', { category: errorCategory(err) })
  process.exit(1)
})

process.on('unhandledRejection', reason => {
  logger.error('process.unhandled_rejection', {
    category: errorCategory(reason),
  })
  process.exit(1)
})
