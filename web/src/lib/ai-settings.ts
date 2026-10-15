import { fetchWithCsrf } from './api'

export type Model = {
  id: string
  name: string
  provider: string
  api: string
  baseUrl: string
  input: ('text' | 'image')[]
  reasoning: boolean
  cost: { input: number; output: number; cacheRead: number; cacheWrite: number }
  contextWindow: number
  maxTokens: number
  [capability: string]: unknown
}
export type AzureConnection = {
  baseUrl: string
  apiVersion: string
  deployments: Record<string, string>
}
export type Provider = {
  id: string
  name: string
  custom: boolean
  authMethods: { type: 'api_key' | 'oauth'; label: string }[]
  auth: { configured: boolean; source?: string; type?: 'api_key' | 'oauth' }
  baseUrl?: string
  api?: string
  keyless?: boolean
  azure?: AzureConnection | null
}
export type Settings = {
  defaultModel: { provider: string; modelId: string } | null
  providers: Provider[]
  customApis: { id: string; label: string }[]
}
export type AuthEvent =
  | { type: 'info'; message: string; links?: { url: string; label?: string }[] }
  | { type: 'auth_url'; url: string; instructions?: string }
  | { type: 'device_code'; userCode: string; verificationUri: string }
  | { type: 'progress'; message: string }
export type LoginState = {
  id: string
  providerId: string
  status: 'pending' | 'complete' | 'error' | 'cancelled'
  prompt?: {
    id: string
    type: 'text' | 'secret' | 'select' | 'manual_code'
    message: string
    placeholder?: string
    options?: { id: string; label: string; description?: string }[]
  }
  events: AuthEvent[]
  error?: string
}
export class SettingsError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}
export async function aiRequest<T>(
  path: string,
  method = 'GET',
  body?: unknown,
  signal?: AbortSignal
): Promise<T> {
  const options: RequestInit = { method, signal, cache: 'no-store' }
  if (body !== undefined) {
    options.headers = { 'Content-Type': 'application/json' }
    options.body = JSON.stringify(body)
  }
  const res = await (method === 'GET'
    ? fetch(`/api/ai${path}`, options)
    : fetchWithCsrf(`/api/ai${path}`, options))
  if (!res.ok) {
    let message = `Could not complete the request (${res.status}). Please retry.`
    if (res.status === 401) message = 'Your session has expired. Sign in again.'
    else if (res.status === 403)
      message = 'Administrator access and a valid security token are required.'
    else {
      try {
        const data: { error?: unknown } = await res.json()
        if (typeof data.error === 'string' && !/[<>]/.test(data.error))
          message = data.error.slice(0, 500)
      } catch {
        /* Never render raw server responses. */
      }
    }
    throw new SettingsError(message, res.status)
  }
  return res.json()
}
export function providerPath(id: string) {
  return `/providers/${encodeURIComponent(id)}`
}
export function safeUrl(value: string): string | undefined {
  try {
    const url = new URL(value)
    if (
      (url.protocol === 'https:' || url.protocol === 'http:') &&
      !url.username &&
      !url.password
    )
      return url.href
  } catch {
    /* Invalid provider link. */
  }
  return undefined
}
