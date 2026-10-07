import { createClient } from '@libsql/client'
import dotenv from 'dotenv'
import { drizzle } from 'drizzle-orm/libsql'
import * as schema from './schema.ts'

dotenv.config({ override: true })

// We use a local Turso file for dev, but this easily swaps to a cloud Turso URL!
// By providing TURSO_SYNC_URL, we enable embedded replicas: blazing fast local reads 
// that automatically backup/sync to your Turso Cloud database.
const client = createClient({
  url: process.env.TURSO_DATABASE_URL || 'file:local-turso.db',
  authToken: process.env.TURSO_AUTH_TOKEN,
  syncUrl: process.env.TURSO_SYNC_URL,
})

// Sync immediately on startup if configured for embedded replica
if (process.env.TURSO_SYNC_URL) {
  client.sync().catch(err => console.error("Failed to sync Turso DB on startup:", err))
}

export const db = drizzle(client, { schema })
