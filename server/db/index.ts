import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createClient } from '@libsql/client'
import { drizzle } from 'drizzle-orm/libsql'
import { migrate } from 'drizzle-orm/libsql/migrator'
import { appStorageConfig } from '../storage/config.ts'
import * as schema from './schema.ts'

if (
  appStorageConfig.url.startsWith('file:') &&
  !appStorageConfig.url.startsWith('file::memory:')
) {
  const file = new URL(appStorageConfig.url, pathToFileURL(`${process.cwd()}/`))
  mkdirSync(dirname(fileURLToPath(file)), { recursive: true })
}

const client = createClient(appStorageConfig)

export const db = drizzle(client, { schema })

export function migrateAppDatabase() {
  return migrate(db, {
    migrationsFolder: fileURLToPath(new URL('../drizzle', import.meta.url)),
  })
}
