import { DrizzleQueryError } from 'drizzle-orm'
import { migrateAppDatabase } from '../db/index.ts'
import { loadSecrets } from '../secretsManager.ts'
import { validateEnvironment } from './env.ts'

// Apply checked-in migrations before settings or auth read the app schema.
try {
  await migrateAppDatabase()
} catch {
  console.error(
    'App database migration failed. Check its connection, credentials, and schema history. No database reset was attempted.'
  )
  process.exit(1)
}

// Evaluate before auth and security modules capture bootstrap signing keys.
try {
  await loadSecrets()
  validateEnvironment()
} catch (error) {
  console.error(
    error instanceof DrizzleQueryError
      ? 'Server settings could not be read from the app database. Check its connection, credentials, and schema.'
      : 'Server settings could not be loaded. Check the encryption key and stored format.'
  )
  process.exit(1)
}
