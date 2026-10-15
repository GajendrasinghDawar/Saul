type Fields = Record<string, string | number | boolean | undefined>

function write(
  level: 'info' | 'warn' | 'error',
  event: string,
  fields: Fields
) {
  console[level](
    JSON.stringify({ ...fields, time: new Date().toISOString(), level, event })
  )
}

// Callers supply metadata only: never bodies, credentials, headers, or raw errors.
export const logger = {
  info: (event: string, fields: Fields = {}) => write('info', event, fields),
  warn: (event: string, fields: Fields = {}) => write('warn', event, fields),
  error: (event: string, fields: Fields = {}) => write('error', event, fields),
}

// Provider errors can contain URLs, credentials, and echoed prompts. Emit a
// bounded classification instead of forwarding arbitrary error text.
export function errorCategory(error: unknown): string {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : ''
  if (/\b401\b|invalid.*(?:key|token)|unauthorized/i.test(message))
    return 'authentication'
  if (/\b403\b|forbidden/i.test(message)) return 'permission'
  if (/\b429\b|rate.limit/i.test(message)) return 'rate_limit'
  if (/timeout|timed.out/i.test(message)) return 'timeout'
  if (/ECONN|ENOTFOUND|fetch failed/i.test(message)) return 'connection'
  return 'unknown'
}
