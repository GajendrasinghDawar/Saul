import { randomUUID } from 'node:crypto'
import { Readable } from 'node:stream'
import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'
import type { Message, UserMessage } from '@earendil-works/pi-ai'

export const attachmentPrefix = 'saul:attachment:'
const literalTextPrefix = 'saul:text:'
export const maxFileBytes = 5 * 1024 * 1024
export const maxTextFileBytes = 64 * 1024
export const maxFilesPerMessage = 4
const maxContextBytes = maxFileBytes * maxFilesPerMessage
const supportedMimeTypes = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'text/plain',
  'text/markdown',
  'text/csv',
  'application/json',
]

export type Attachment = {
  id: string
  name: string
  mimeType: string
  size: number
}

export type S3Settings = {
  endpoint: string
  region: string
  bucket: string
  accessKeyId: string
  secretAccessKey: string
}

export class AttachmentError extends Error {
  status: number

  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

/** Bytes and file metadata live in S3. No file or metadata is written to disk. */
export class AttachmentStore {
  private client: S3Client | undefined
  private bucket: string

  constructor(settings?: S3Settings) {
    this.bucket = settings?.bucket ?? ''
    if (settings) {
      this.client = new S3Client({
        endpoint: settings.endpoint,
        region: settings.region,
        credentials: {
          accessKeyId: settings.accessKeyId,
          secretAccessKey: settings.secretAccessKey,
        },
        forcePathStyle: true,
        maxAttempts: 3,
        requestChecksumCalculation: 'WHEN_REQUIRED',
        responseChecksumValidation: 'WHEN_REQUIRED',
        requestHandler: { connectionTimeout: 5_000, requestTimeout: 30_000 },
      })
    }
  }

  capabilities(supportsImages: boolean) {
    return {
      enabled: Boolean(this.client),
      supportedMimeTypes,
      maxFileBytes,
      maxTextFileBytes,
      maxFilesPerMessage,
      supportsImages,
    }
  }

  async upload(userId: string, name: string, mimeType: string, data: Buffer) {
    const client = this.configured()
    if (!validName(name))
      throw new AttachmentError(
        400,
        'Use a file name without paths or control characters.'
      )
    validateFile(mimeType, data)
    const id = randomUUID()
    try {
      await client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: this.key(userId, id),
          Body: data,
          ContentType: mimeType,
          Metadata: { filename: encodeURIComponent(name) },
        }),
        { abortSignal: AbortSignal.timeout(30_000) }
      )
    } catch {
      throw new AttachmentError(
        503,
        'Could not store the file. Check S3 settings and retry the upload.'
      )
    }
    return { id, name, mimeType, size: data.length } satisfies Attachment
  }

  async info(userId: string, id: string): Promise<Attachment> {
    const client = this.configured()
    try {
      const object = await client.send(
        new GetObjectCommand({
          Bucket: this.bucket,
          Key: this.key(userId, id),
        }),
        { abortSignal: AbortSignal.timeout(30_000) }
      )
      // Some S3-compatible services reject HEAD but support authenticated GET.
      // Only headers are needed here; do not buffer the response body.
      if (object.Body instanceof Readable) object.Body.destroy()
      return metadata(id, object)
    } catch (error) {
      throw storageError(error)
    }
  }

  async read(userId: string, id: string) {
    const client = this.configured()
    let body: Readable | undefined
    try {
      const object = await client.send(
        new GetObjectCommand({
          Bucket: this.bucket,
          Key: this.key(userId, id),
        }),
        { abortSignal: AbortSignal.timeout(30_000) }
      )
      if (!(object.Body instanceof Readable))
        throw new AttachmentError(503, 'Could not read the stored file.')
      body = object.Body
      const attachment = metadata(id, object)
      const chunks: Buffer[] = []
      let size = 0
      for await (const chunk of body) {
        if (!(chunk instanceof Uint8Array))
          throw new AttachmentError(503, 'Could not read the stored file.')
        size += chunk.byteLength
        if (size > maxFileBytes)
          throw new AttachmentError(413, 'Stored file exceeds the 5 MiB limit.')
        chunks.push(Buffer.from(chunk))
      }
      const data = Buffer.concat(chunks)
      if (size !== attachment.size)
        throw new AttachmentError(
          503,
          'Stored file is incomplete. Upload it again.'
        )
      validateFile(attachment.mimeType, data)
      return { attachment, data }
    } catch (error) {
      throw storageError(error)
    } finally {
      body?.destroy()
    }
  }

  async prepare(userId: string, ids: string[], supportsImages: boolean) {
    if (ids.length > maxFilesPerMessage || new Set(ids).size !== ids.length)
      throw new AttachmentError(
        400,
        'Attach up to four different files per message.'
      )
    const attachments: Attachment[] = []
    for (const id of ids) {
      const attachment = await this.info(userId, id)
      if (attachment.mimeType.startsWith('image/') && !supportsImages)
        throw new AttachmentError(
          400,
          'This model does not accept images. Use an image-capable model or remove the image.'
        )
      attachments.push(attachment)
    }
    return attachments
  }

  /** Replace references for this provider request only; never modify stored messages. */
  async hydrate(
    messages: readonly Message[],
    userId: string,
    supportsImages: boolean
  ) {
    let bytes = 0
    const result: Message[] = []
    const files = new Map<
      string,
      Awaited<ReturnType<AttachmentStore['read']>>
    >()
    for (const message of messages) {
      if (message.role !== 'user' || typeof message.content === 'string') {
        result.push(message)
        continue
      }
      const content: Exclude<UserMessage['content'], string> = []
      for (const part of message.content) {
        if (part.type === 'text' && part.text.startsWith(literalTextPrefix)) {
          content.push({
            type: 'text',
            text: part.text.slice(literalTextPrefix.length),
          })
          continue
        }
        const reference =
          part.type === 'text' ? attachmentReference(part.text) : undefined
        if (!reference) {
          content.push(part)
          continue
        }
        const file =
          files.get(reference.id) ?? (await this.read(userId, reference.id))
        files.set(reference.id, file)
        bytes += file.data.length
        if (bytes > maxContextBytes)
          throw new AttachmentError(
            413,
            'The active chat has more than 20 MiB of files. Start a new chat.'
          )
        content.push({
          type: 'text',
          text: `Attached file: ${file.attachment.name}\n`,
        })
        if (file.attachment.mimeType.startsWith('image/')) {
          if (!supportsImages)
            throw new AttachmentError(
              400,
              'This model does not accept the images in this chat. Use an image-capable model.'
            )
          content.push({
            type: 'image',
            data: file.data.toString('base64'),
            mimeType: file.attachment.mimeType,
          })
        } else {
          content.push({
            type: 'text',
            text: new TextDecoder('utf-8', { fatal: true }).decode(file.data),
          })
        }
      }
      result.push({ ...message, content })
    }
    return result
  }

  close() {
    this.client?.destroy()
  }

  private configured() {
    if (!this.client)
      throw new AttachmentError(
        503,
        'Attachment storage is not configured. Set the S3 settings and restart the server.'
      )
    return this.client
  }

  private key(userId: string, id: string) {
    if (
      !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(
        id
      )
    )
      throw new AttachmentError(400, 'Invalid attachment ID.')
    return `saul/attachments/${encodeURIComponent(userId)}/${id}`
  }
}

export function attachmentReference(text: string): Attachment | undefined {
  if (!text.startsWith(attachmentPrefix)) return undefined
  try {
    const value: unknown = JSON.parse(text.slice(attachmentPrefix.length))
    if (typeof value !== 'object' || value === null) return undefined
    const ref = value as Record<string, unknown>
    if (
      typeof ref.id !== 'string' ||
      typeof ref.name !== 'string' ||
      typeof ref.mimeType !== 'string' ||
      typeof ref.size !== 'number' ||
      !Number.isFinite(ref.size) ||
      ref.size < 0
    )
      return undefined
    return {
      id: ref.id,
      name: ref.name,
      mimeType: ref.mimeType,
      size: ref.size,
    }
  } catch {
    return undefined
  }
}

export function attachmentContent(
  message: string,
  attachments: Attachment[]
): UserMessage['content'] {
  if (attachments.length === 0) return message
  return [
    ...(message
      ? [{ type: 'text' as const, text: literalTextPrefix + message }]
      : []),
    ...attachments.map(attachment => ({
      type: 'text' as const,
      text: attachmentPrefix + JSON.stringify(attachment),
    })),
  ]
}

function validName(name: string) {
  return (
    Boolean(name.trim()) &&
    name.length <= 255 &&
    !Array.from(name).some(
      character =>
        character.charCodeAt(0) < 32 ||
        character.charCodeAt(0) === 127 ||
        character === '/' ||
        character === '\\'
    )
  )
}

function validateFile(mimeType: string, data: Buffer) {
  if (!supportedMimeTypes.includes(mimeType))
    throw new AttachmentError(
      415,
      'Unsupported file type. Use PNG, JPEG, WebP, or a UTF-8 text file. PDF, audio, and video are not supported yet.'
    )
  if (data.length === 0 || data.length > maxFileBytes)
    throw new AttachmentError(
      413,
      'Files must be nonempty and no larger than 5 MiB.'
    )
  if (mimeType.startsWith('image/')) {
    const matches =
      mimeType === 'image/png'
        ? data
            .subarray(0, 8)
            .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
        : mimeType === 'image/jpeg'
          ? data[0] === 255 &&
            data[1] === 216 &&
            data[2] === 255 &&
            data.at(-2) === 255 &&
            data.at(-1) === 217
          : data.length >= 12 &&
            data.toString('ascii', 0, 4) === 'RIFF' &&
            data.toString('ascii', 8, 12) === 'WEBP' &&
            data.readUInt32LE(4) === data.length - 8
    if (!matches)
      throw new AttachmentError(
        415,
        'The file content does not match its image type.'
      )
  } else {
    if (data.length > maxTextFileBytes)
      throw new AttachmentError(
        413,
        'Text files must be no larger than 64 KiB. Split the file before uploading.'
      )
    try {
      const text = new TextDecoder('utf-8', { fatal: true }).decode(data)
      if (text.includes('\0')) throw new Error()
    } catch {
      throw new AttachmentError(
        415,
        'Text files must contain valid UTF-8 text, without null bytes.'
      )
    }
  }
}

function metadata(
  id: string,
  object: {
    ContentLength?: number
    ContentType?: string
    Metadata?: Record<string, string>
  }
): Attachment {
  let name = ''
  try {
    name = decodeURIComponent(object.Metadata?.filename ?? '')
  } catch {
    /* Invalid stored metadata is rejected below. */
  }
  const size = object.ContentLength
  const mimeType = object.ContentType ?? ''
  if (
    !validName(name) ||
    size === undefined ||
    size <= 0 ||
    size > maxFileBytes ||
    !supportedMimeTypes.includes(mimeType)
  )
    throw new AttachmentError(
      503,
      'Stored file metadata is invalid. Upload the file again.'
    )
  return { id, name, mimeType, size }
}

function storageError(error: unknown) {
  if (error instanceof AttachmentError) return error
  if (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    (error.name === 'NotFound' || error.name === 'NoSuchKey')
  )
    return new AttachmentError(
      404,
      'Attachment not found or not owned by this account.'
    )
  return new AttachmentError(
    503,
    'Could not read the file from S3. Check storage settings and retry.'
  )
}
