import { existsSync } from 'node:fs'

// Load bootstrap values before database clients or auth capture them.
// Deployment environment values take priority over the development .env file.
if (existsSync('.env')) process.loadEnvFile()

const mode = process.env.NODE_ENV || 'development'
if (!['development', 'test', 'production'].includes(mode))
  throw new Error('NODE_ENV must be development, test, or production')

function remoteStorageConfig(
  name: string,
  url: string | undefined,
  authToken: string | undefined
) {
  if (!url || !URL.canParse(url))
    throw new Error(`Production requires ${name}_DATABASE_URL`)
  const parsed = new URL(url)
  if (
    !['libsql:', 'https:'].includes(parsed.protocol) ||
    parsed.hostname === 'localhost' ||
    parsed.hostname.endsWith('.localhost') ||
    parsed.hostname.startsWith('127.') ||
    parsed.hostname === '[::1]' ||
    parsed.username ||
    parsed.password
  )
    throw new Error(
      `${name}_DATABASE_URL must point to a remote libSQL database`
    )
  if (!authToken?.trim())
    throw new Error(`Production requires ${name}_DATABASE_TOKEN`)
  return { url, authToken }
}

const appUrl = process.env.SAUL_APP_STORAGE_DATABASE_URL
const durableUrl = process.env.SAUL_DURABLE_STORAGE_DATABASE_URL

export const appStorageConfig =
  mode === 'production'
    ? remoteStorageConfig(
        'SAUL_APP_STORAGE',
        appUrl,
        process.env.SAUL_APP_STORAGE_DATABASE_TOKEN
      )
    : {
        url: appUrl?.startsWith('file:')
          ? appUrl
          : 'file:./data/saul-app.dev.sqlite',
        authToken: undefined,
      }

export const durableStorageConfig = {
  ...(mode === 'production'
    ? remoteStorageConfig(
        'SAUL_DURABLE_STORAGE',
        durableUrl,
        process.env.SAUL_DURABLE_STORAGE_DATABASE_TOKEN
      )
    : {
        url: durableUrl?.startsWith('file:') ? durableUrl : undefined,
        authToken: undefined,
      }),
  localPath: './data/saul-pi.dev.sqlite',
}

if (appStorageConfig.url === durableStorageConfig.url)
  throw new Error('App and Pi storage require separate databases')
