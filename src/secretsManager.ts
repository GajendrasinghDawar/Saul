import { db } from './db/index.js'
import { secrets } from './db/schema.js'

let secretsCache: Record<string, string> = {}

export async function loadSecrets() {
  const allSecrets = await db.select().from(secrets)
  secretsCache = {}
  for (const s of allSecrets) {
    secretsCache[s.name] = s.value
  }
}

export function updateSecretCache(name: string, value: string) {
  secretsCache[name] = value
}

export function deleteSecretCache(name: string) {
  delete secretsCache[name]
}

export function getSecret(name: string, fallback?: string): string {
  if (name in secretsCache) {
    return secretsCache[name]
  }
  if (process.env[name] !== undefined) {
    return process.env[name] as string
  }
  if (fallback !== undefined) {
    return fallback
  }
  return ''
}

export function getRequiredSecret(name: string): string {
  const value = getSecret(name)
  if (!value) {
    throw new Error(`Missing required secret: ${name}`)
  }
  return value
}
