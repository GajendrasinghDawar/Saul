import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

const prefix = 'saul:v1:'

function encryptionKey() {
  const key = process.env.SAUL_SECRETS_KEY
  if (!key || !/^[a-fA-F0-9]{64}$/.test(key)) {
    throw new Error(
      'Settings encryption requires SAUL_SECRETS_KEY (64 hex characters)'
    )
  }
  return Buffer.from(key, 'hex')
}

export function encryptSetting(name: string, value: string) {
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

export function decryptSetting(name: string, value: string) {
  try {
    if (!value.startsWith(prefix)) throw new Error()
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
      'Stored settings cannot be unlocked. Check the encryption key and stored format.'
    )
  }
}

export function getSecret(name: string, fallback = ''): string {
  return process.env[name] ?? fallback
}
export function getRequiredSecret(name: string): string {
  const value = getSecret(name)
  if (!value) throw new Error(`Missing required secret: ${name}`)
  return value
}
export function validateSettingValue(
  name: string,
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
  if (name === 'S3_REGION') return /^[a-z0-9-]{1,64}$/.test(value)
  if (name === 'S3_BUCKET')
    return (
      /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(value) && !value.includes('..')
    )
  if (name === 'S3_ENDPOINT') {
    try {
      const url = new URL(value)
      return (
        (url.protocol === 'https:' ||
          (name === 'S3_ENDPOINT' &&
            getSecret('NODE_ENV') !== 'production' &&
            url.protocol === 'http:' &&
            ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) &&
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
