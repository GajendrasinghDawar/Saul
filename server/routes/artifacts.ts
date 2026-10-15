import express, {
  type ErrorRequestHandler,
  type Request,
  type RequestHandler,
  type Response,
  Router,
} from 'express'
import rateLimit from 'express-rate-limit'
import {
  AttachmentError,
  type AttachmentStore,
  maxFileBytes,
} from '../services/attachments.ts'

export function createArtifactsRouter(
  store: AttachmentStore,
  supportsImages: (req: Request, res: Response) => boolean | Promise<boolean>,
  csrf: RequestHandler
) {
  const router = Router()
  router.use((_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store')
    next()
  })
  router.get('/capabilities', async (req, res) => {
    try {
      const images = await supportsImages(req, res)
      res.json(store.capabilities(images))
    } catch (error) {
      res.status(error instanceof AttachmentError ? error.status : 503).json({
        error:
          error instanceof AttachmentError
            ? error.message
            : 'Could not read model capabilities.',
      })
    }
  })
  router.post(
    '/',
    csrf,
    rateLimit({ windowMs: 60_000, limit: 20 }),
    express.raw({
      type: 'application/octet-stream',
      limit: maxFileBytes,
      inflate: false,
    }),
    async (req, res) => {
      try {
        if (!Buffer.isBuffer(req.body))
          throw new AttachmentError(
            415,
            'Upload files as application/octet-stream.'
          )
        let name: string
        try {
          name = decodeURIComponent(req.get('x-file-name') ?? '')
        } catch {
          throw new AttachmentError(400, 'Invalid file name.')
        }
        const attachment = await store.upload(
          String(res.locals.userId),
          name,
          req.get('x-file-type') ?? '',
          req.body
        )
        res.status(201).json(attachment)
      } catch (error) {
        if (error instanceof AttachmentError)
          return res.status(error.status).json({ error: error.message })
        res.status(503).json({ error: 'Could not upload the file.' })
      }
    }
  )
  router.get('/:id', async (req, res) => {
    try {
      const { attachment, data } = await store.read(
        String(res.locals.userId),
        req.params.id
      )
      // Always download. Never execute uploaded HTML or other active content.
      res.setHeader('X-Content-Type-Options', 'nosniff')
      res.setHeader('Content-Type', attachment.mimeType)
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="download"; filename*=UTF-8''${encodeURIComponent(attachment.name).replace(/['()*]/g, char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)}`
      )
      res.send(data)
    } catch (error) {
      if (error instanceof AttachmentError)
        return res.status(error.status).json({ error: error.message })
      res.status(503).json({ error: 'Could not download the file.' })
    }
  })
  const bodyError: ErrorRequestHandler = (error, _req, res, _next) => {
    if (error.code === 'EBADCSRFTOKEN') {
      res.status(403).json({ error: 'A valid security token is required.' })
      return
    }
    const tooLarge = error.type === 'entity.too.large'
    res.status(tooLarge ? 413 : 400).json({
      error: tooLarge
        ? 'Files must be no larger than 5 MiB.'
        : 'Invalid upload body.',
    })
  }
  router.use(bodyError)
  return router
}
