import { defineConfig } from 'drizzle-kit'
import { appStorageConfig } from './storage/config.ts'

if (process.argv.includes('push'))
  throw new Error(
    'Schema push is disabled. Generate and review migrations; startup applies them.'
  )

export default defineConfig({
  schema: './server/db/schema.ts',
  out: './server/drizzle',
  dialect: 'turso',
  dbCredentials: appStorageConfig,
})
