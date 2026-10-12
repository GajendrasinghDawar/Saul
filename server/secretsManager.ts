import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { db } from './db/index.ts'
import { secrets } from './db/schema.ts'

export const settingDefinitions = {
  AZURE_OPENAI_API_KEY: { kind: 'secret', applyMode: 'live' },
  RESEND_API_KEY: { kind: 'secret', applyMode: 'live' },
  MY_EMAIL_ADDRESS: { kind: 'env', applyMode: 'live' },
  AZURE_OPENAI_BASE_URL: { kind: 'env', applyMode: 'restart' },
  AZURE_OPENAI_MODEL: { kind: 'env', applyMode: 'restart' },
} as const
export type SettingName = keyof typeof settingDefinitions
const secretsCache = new Map<string, string>()
const activeSettings = new Map<string, string>()
const prefix = 'saul:v1:'

export function isSettingName(name: unknown): name is SettingName {
  return typeof name === 'string' && Object.hasOwn(settingDefinitions, name)
}

function encryptionKey() {
  const key = process.env.SAUL_SECRETS_KEY
  if (!key || !/^[a-fA-F0-9]{64}$/.test(key)) {
    throw new Error(
      'Settings encryption requires SAUL_SECRETS_KEY (64 hex characters)'
    )
  }
  return Buffer.from(key, 'hex')
}

export function encryptSetting(name: SettingName, value: string) {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv)
  cipher.setAAD(Buffer.from(name))
  const encrypted = Buffer.concat([
    cipher.update(value, 'utf8'),
    cipher.final(),
  ])
  return (
    prefix +
    Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64')
  )
}

function decryptSetting(name: string, value: string) {
  try {
    const data = Buffer.from(value.slice(prefix.length), 'base64')
    if (data.length < 29) throw new Error()
    const cipher = createDecipheriv(
      'aes-256-gcm',
      encryptionKey(),
      data.subarray(0, 12)
    )
    cipher.setAAD(Buffer.from(name))
    cipher.setAuthTag(data.subarray(12, 28))
    return Buffer.concat([
      cipher.update(data.subarray(28)),
      cipher.final(),
    ]).toString('utf8')
  } catch {
    throw new Error(
      'Stored settings cannot be unlocked. Check the encryption key and migration state.'
    )
  }
}

export async function loadSecrets() {
  const allSecrets = await db.select().from(secrets)
  const loaded = new Map<string, string>()
  for (const s of allSecrets) {
    if (s.value.startsWith(prefix))
      loaded.set(s.name, decryptSetting(s.name, s.value))
    else if (isSettingName(s.name)) {
      throw new Error(
        'Legacy service settings require an explicit offline migration'
      )
    } else loaded.set(s.name, s.value) // Preserve existing bootstrap signing keys.
  }
  secretsCache.clear()
  for (const [name, value] of loaded) secretsCache.set(name, value)
}

export function updateSecretCache(name: string, value: string) {
  secretsCache.set(name, value)
}
export function deleteSecretCache(name: string) {
  secretsCache.delete(name)
}
export function getSecret(name: string, fallback = ''): string {
  return secretsCache.get(name) ?? process.env[name] ?? fallback
}
export function getRequiredSecret(name: string): string {
  const value = getSecret(name)
  if (!value) throw new Error(`Missing required secret: ${name}`)
  return value
}
export function markSettingActive(name: SettingName, value: string) {
  activeSettings.set(name, value)
}
export function settingStatus(name: SettingName) {
  const definition = settingDefinitions[name]
  const value = getSecret(name)
  const effective =
    name === 'AZURE_OPENAI_MODEL' ? value || 'gpt-6-luna' : value
  return {
    name,
    ...definition,
    value: definition.kind === 'secret' ? null : value || null,
    isSet: Boolean(value),
    pendingRestart:
      definition.applyMode === 'restart' &&
      activeSettings.has(name) &&
      activeSettings.get(name) !== effective,
  }
}

export function validateSettingValue(
  name: SettingName,
  value: unknown
): value is string {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value !== value.trim() ||
    value.length > 4096 ||
    Array.from(value).some(
      character =>
        character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127
    ) ||
    value === '••••••••'
  )
    return false
  if (name === 'MY_EMAIL_ADDRESS')
    return value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
  if (name === 'AZURE_OPENAI_MODEL')
    return value.length <= 256 && /^[a-zA-Z0-9._-]+$/.test(value)
  if (name === 'AZURE_OPENAI_BASE_URL') {
    try {
      const url = new URL(value)
      return (
        url.protocol === 'https:' &&
        !url.username &&
        !url.password &&
        !url.search &&
        !url.hash
      )
    } catch {
      return false
    }
  }
  return true
}
