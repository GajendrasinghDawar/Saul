import assert from 'node:assert/strict'
import { once } from 'node:events'
import { createServer, type Server } from 'node:http'
import test from 'node:test'
import type { Message } from '@earendil-works/pi-ai'
import express from 'express'
import { createArtifactsRouter } from '../routes/artifacts.ts'
import {
  type Attachment,
  AttachmentStore,
  attachmentContent,
  maxFileBytes,
  maxTextFileBytes,
} from '../services/attachments.ts'

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jQ6kAAAAASUVORK5CYII=',
  'base64'
)

async function listen(server: Server) {
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  assert.ok(address && typeof address !== 'string')
  return `http://127.0.0.1:${address.port}`
}

async function close(server: Server) {
  server.closeAllConnections()
  await new Promise<void>((resolve, reject) =>
    server.close(error => (error ? reject(error) : resolve()))
  )
}

/** In-memory S3 HTTP fixture, not a substitute for testing a chosen S3 provider. */
async function fixture(headForbidden = false) {
  const objects = new Map<
    string,
    { data: Buffer; mime: string; filename: string }
  >()
  const s3 = createServer(async (req, res) => {
    if (
      !req.headers.authorization?.startsWith(
        'AWS4-HMAC-SHA256 Credential=fixture/'
      )
    ) {
      res.writeHead(403).end()
      return
    }
    if (req.method === 'HEAD' && headForbidden) {
      res.writeHead(403).end()
      return
    }
    const key = new URL(req.url ?? '/', 'http://fixture').pathname
    if (req.method === 'PUT') {
      const chunks: Buffer[] = []
      for await (const chunk of req) chunks.push(Buffer.from(chunk))
      objects.set(key, {
        data: Buffer.concat(chunks),
        mime: String(req.headers['content-type']),
        filename: String(req.headers['x-amz-meta-filename']),
      })
      res.writeHead(200, { etag: '"fixture"' }).end()
      return
    }
    const object = objects.get(key)
    if (!object) {
      res
        .writeHead(404, { 'content-type': 'application/xml' })
        .end('<Error><Code>NoSuchKey</Code></Error>')
      return
    }
    res.writeHead(200, {
      'content-type': object.mime,
      'content-length': object.data.length,
      'x-amz-meta-filename': object.filename,
    })
    res.end(req.method === 'HEAD' ? undefined : object.data)
  })
  const settings = {
    endpoint: await listen(s3),
    region: 'us-east-1',
    bucket: 'fixture',
    accessKeyId: 'fixture',
    secretAccessKey: 'fixture-secret',
  }
  const store = new AttachmentStore(settings)
  const app = express()
  // Test-only identity resolver. Real Better Auth and CSRF are checked separately.
  app.use((req, res, next) => {
    const identity = req.headers.authorization
    if (identity !== 'Bearer alice' && identity !== 'Bearer bob')
      return res.status(401).end()
    res.locals.userId = identity.slice('Bearer '.length)
    next()
  })
  app.use(
    '/api/artifacts',
    createArtifactsRouter(
      store,
      () => true,
      (_req, _res, next) => next()
    )
  )
  const api = createServer(app)
  const baseUrl = await listen(api)
  return {
    store,
    settings,
    baseUrl,
    close: async () => {
      store.close()
      await close(api)
      await close(s3)
    },
  }
}

test('S3 uploads remain usable when HEAD is forbidden and hydrate after the application restarts', async t => {
  const f = await fixture(true)
  t.after(f.close)
  async function upload(name: string, mime: string, data: Buffer) {
    const response = await fetch(`${f.baseUrl}/api/artifacts`, {
      method: 'POST',
      headers: {
        authorization: 'Bearer alice',
        'content-type': 'application/octet-stream',
        'x-file-name': encodeURIComponent(name),
        'x-file-type': mime,
      },
      body: new Uint8Array(data),
    })
    assert.equal(response.status, 201)
    return (await response.json()) as Attachment
  }
  const text = 'Skills: TypeScript, Kotlin.\nAvailable: November.\n'
  const note = await upload(
    'résumé notes.md',
    'text/markdown',
    Buffer.from(text)
  )
  const image = await upload('diagram.png', 'image/png', png)
  const refs = await f.store.prepare('alice', [note.id, image.id], true)
  const messages: Message[] = [
    {
      role: 'user',
      content: attachmentContent('Use both files.', refs),
      timestamp: 1,
    },
  ]
  const persisted = JSON.stringify(messages)
  assert.ok(!persisted.includes(text))
  assert.ok(!persisted.includes(png.toString('base64')))
  const hydrated = await f.store.hydrate(messages, 'alice', true)
  const content = hydrated[0].content
  assert.ok(Array.isArray(content))
  assert.ok(content.some(part => part.type === 'text' && part.text === text))
  assert.ok(
    content.some(
      part =>
        part.type === 'image' &&
        part.data === png.toString('base64') &&
        part.mimeType === 'image/png'
    )
  )
  assert.equal(JSON.stringify(messages), persisted)
  const literal = `saul:attachment:${JSON.stringify({ ...note, id: 'not-a-file' })}`
  const literalMessages: Message[] = [
    { role: 'user', content: attachmentContent(literal, refs), timestamp: 2 },
  ]
  const literalHydrated = await f.store.hydrate(literalMessages, 'alice', true)
  assert.ok(Array.isArray(literalHydrated[0].content))
  assert.deepEqual(literalHydrated[0].content[0], {
    type: 'text',
    text: literal,
  })
  assert.equal(attachmentContent(literal, []), literal)
  const replacement = new AttachmentStore(f.settings)
  t.after(() => replacement.close())
  assert.deepEqual(await replacement.hydrate(messages, 'alice', true), hydrated)
  const downloaded = await fetch(`${f.baseUrl}/api/artifacts/${note.id}`, {
    headers: { authorization: 'Bearer alice' },
  })
  assert.equal(downloaded.status, 200)
  assert.equal(await downloaded.text(), text)
  assert.match(
    downloaded.headers.get('content-disposition') ?? '',
    /^attachment;/
  )
  assert.match(
    downloaded.headers.get('content-disposition') ?? '',
    /r%C3%A9sum%C3%A9%20notes.md/
  )
  assert.equal(downloaded.headers.get('cache-control'), 'no-store')
  assert.equal(downloaded.headers.get('x-content-type-options'), 'nosniff')
  assert.equal(
    (
      await fetch(`${f.baseUrl}/api/artifacts/${note.id}`, {
        headers: { authorization: 'Bearer bob' },
      })
    ).status,
    404
  )
  assert.equal(
    (await fetch(`${f.baseUrl}/api/artifacts/${note.id}`)).status,
    401
  )
  await assert.rejects(f.store.prepare('bob', [image.id], true), {
    status: 404,
  })
  await assert.rejects(f.store.prepare('alice', [image.id], false), {
    status: 400,
  })
  await assert.rejects(f.store.hydrate(messages, 'alice', false), {
    status: 400,
  })
  await assert.rejects(f.store.prepare('alice', [note.id, note.id], true), {
    status: 400,
  })
  await assert.rejects(f.store.prepare('alice', Array(5).fill(note.id), true), {
    status: 400,
  })
})

test('file upload limits and content checks reject unsupported or disguised data', async t => {
  const f = await fixture()
  t.after(f.close)
  for (const [name, mime, body, status] of [
    ['notes.txt', 'text/plain', Buffer.from(''), 413],
    ['notes.txt', 'text/plain', Buffer.alloc(maxTextFileBytes + 1, 65), 413],
    ['large.png', 'image/png', Buffer.alloc(maxFileBytes + 1), 413],
    ['fake.png', 'image/png', Buffer.from('<script>bad()</script>'), 415],
    ['notes.txt', 'text/plain', Buffer.from([255, 254]), 415],
    ['notes.txt', 'text/plain', Buffer.from([65, 0, 66]), 415],
    ['resume.pdf', 'application/pdf', Buffer.from('%PDF-1.7'), 415],
    ['../notes.txt', 'text/plain', Buffer.from('abc'), 400],
  ] as const) {
    const response = await fetch(`${f.baseUrl}/api/artifacts`, {
      method: 'POST',
      headers: {
        authorization: 'Bearer alice',
        'content-type': 'application/octet-stream',
        'x-file-name': encodeURIComponent(name),
        'x-file-type': mime,
      },
      body: new Uint8Array(body),
    })
    assert.equal(response.status, status, name)
  }
  assert.equal(
    (
      await f.store.upload(
        'alice',
        'boundary.txt',
        'text/plain',
        Buffer.alloc(maxTextFileBytes, 65)
      )
    ).size,
    maxTextFileBytes
  )
  const disabled = new AttachmentStore()
  assert.equal(disabled.capabilities(true).enabled, false)
  await assert.rejects(
    disabled.upload('alice', 'notes.txt', 'text/plain', Buffer.from('abc')),
    { status: 503 }
  )
})
