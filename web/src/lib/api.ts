let cachedCsrfToken: string | null = null

export async function initCsrfToken(): Promise<void> {
  if (cachedCsrfToken) return
  const res = await fetch('/csrf-token')
  const data = await res.json()
  cachedCsrfToken = data.csrfToken
}

export async function getCsrfToken(): Promise<string> {
  if (!cachedCsrfToken) await initCsrfToken()
  return cachedCsrfToken as string
}

export async function fetchWithCsrf(url: string, options: RequestInit = {}) {
  const token = await getCsrfToken()
  const headers = new Headers(options.headers || {})
  headers.set('x-csrf-token', token)

  return fetch(url, {
    ...options,
    headers,
  })
}

export type Attachment = {
  id: string
  name: string
  mimeType: string
  size: number
}
export type ArtifactCapabilities = {
  enabled: boolean
  supportedMimeTypes: string[]
  maxFileBytes: number
  maxTextFileBytes: number
  maxFilesPerMessage: number
  supportsImages: boolean
}

export async function responseError(res: Response): Promise<string> {
  const body = await res.text()
  try {
    const data: { error?: unknown; message?: unknown } = JSON.parse(body)
    if (typeof data.error === 'string') return data.error
    if (typeof data.message === 'string') return data.message
  } catch {
    /* Non-JSON errors may still contain a useful message. */
  }
  return body || `Request failed (${res.status})`
}

export async function getArtifactCapabilities(): Promise<ArtifactCapabilities> {
  const res = await fetch('/api/artifacts/capabilities')
  if (!res.ok) throw new Error(await responseError(res))
  return res.json()
}

export function fileMimeType(file: File): string {
  const types: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    webp: 'image/webp',
    txt: 'text/plain',
    md: 'text/markdown',
    markdown: 'text/markdown',
    csv: 'text/csv',
    json: 'application/json',
  }
  return (
    types[file.name.split('.').at(-1)?.toLowerCase() ?? ''] ||
    file.type ||
    'application/octet-stream'
  )
}

export async function uploadFile(file: File): Promise<Attachment> {
  const res = await fetchWithCsrf('/api/artifacts', {
    method: 'POST',
    headers: {
      'x-file-name': encodeURIComponent(file.name),
      'x-file-type': fileMimeType(file),
      'Content-Type': 'application/octet-stream',
    },
    body: file,
  })
  if (!res.ok) throw new Error(await responseError(res))
  return res.json()
}

export async function approveEffect(id: string, digest: string): Promise<void> {
  const res = await fetchWithCsrf(`/api/tasks/approvals/${id}/approve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ digest }),
  })
  if (!res.ok) throw new Error('Failed to approve effect')
}

export async function rejectEffect(id: string): Promise<void> {
  const res = await fetchWithCsrf(`/api/tasks/approvals/${id}/reject`, {
    method: 'POST',
  })
  if (!res.ok) throw new Error('Failed to reject effect')
}
