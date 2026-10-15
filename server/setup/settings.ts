import { migrateAppDatabase } from '../db/index.ts'
import { errorCategory, logger } from '../logger.ts'
import { validateEnvironment } from './env.ts'

// Apply checked-in migrations before settings or auth read the app schema.
try {
  await migrateAppDatabase()
  logger.info('app_database.ready')
} catch (error) {
  logger.error('app_database.migration_failed', {
    category: errorCategory(error),
    message:
      'App database migration failed. Check its connection, credentials, and schema history. No database reset was attempted.',
  })
  process.exit(1)
}

// Evaluate before auth and security modules capture bootstrap signing keys.
try {
  validateEnvironment()
  logger.info('settings.ready')
} catch (error) {
  logger.error('settings.load_failed', {
    category: errorCategory(error),
    message: 'Server environment configuration could not be validated.',
  })
  process.exit(1)
}
