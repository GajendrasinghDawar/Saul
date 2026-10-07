import { eq } from 'drizzle-orm'
import { Router } from 'express'
import { db } from '../db/index.js'
import { secrets } from '../db/schema.js'
import { deleteSecretCache, updateSecretCache } from '../secretsManager.ts'

export const secretsRouter = Router()

// List all secrets
secretsRouter.get('/', async (_req, res) => {
  try {
    const allSecrets = await db.select().from(secrets)
    // Mask secret values before sending to client
    const safeSecrets = allSecrets.map(s => ({
      ...s,
      value: s.kind === 'secret' ? '••••••••' : s.value,
    }))
    res.json(safeSecrets)
  } catch (_error) {
    res.status(500).json({ error: 'Failed to fetch secrets' })
  }
})

// Add or update a secret
secretsRouter.post('/', async (req, res) => {
  try {
    const { name, value, kind, allowedHosts } = req.body

    if (!name || !value || !kind) {
      return res.status(400).json({ error: 'Missing required fields' })
    }

    // Check if updating and trying to keep masked value
    if (kind === 'secret' && value === '••••••••') {
      return res.status(400).json({ error: 'Cannot save masked value' })
    }

    const userId = res.locals.userId || 'system'

    await db
      .insert(secrets)
      .values({
        name,
        value,
        kind,
        allowedHosts: allowedHosts || null,
        updatedAt: new Date(),
        updatedBy: userId,
      })
      .onConflictDoUpdate({
        target: secrets.name,
        set: {
          value,
          kind,
          allowedHosts: allowedHosts || null,
          updatedAt: new Date(),
          updatedBy: userId,
        },
      })

    updateSecretCache(name, value)
    res.json({ success: true })
  } catch (_error) {
    res.status(500).json({ error: 'Failed to save secret' })
  }
})

// Bulk add or update secrets
secretsRouter.post('/bulk', async (req, res) => {
  try {
    const { entries } = req.body

    if (!Array.isArray(entries)) {
      return res.status(400).json({ error: 'entries must be an array' })
    }

    const userId = res.locals.userId || 'system'

    const values = entries
      .map((entry: Record<string, string>) => ({
        name: entry.name,
        value: entry.value,
        kind: entry.kind,
        allowedHosts: entry.allowedHosts || null,
        updatedAt: new Date(),
        updatedBy: userId,
      }))
      .filter(entry => !(entry.kind === 'secret' && entry.value === '••••••••'))

    if (values.length > 0) {
      for (const val of values) {
        await db
          .insert(secrets)
          .values(val)
          .onConflictDoUpdate({
            target: secrets.name,
            set: {
              value: val.value,
              kind: val.kind,
              allowedHosts: val.allowedHosts,
              updatedAt: new Date(),
              updatedBy: val.updatedBy,
            },
          })
        updateSecretCache(val.name, val.value)
      }
    }

    res.json({ success: true, saved: values.length })
  } catch (_error) {
    res.status(500).json({ error: 'Failed to save secrets' })
  }
})

// Delete a secret
secretsRouter.delete('/:name', async (req, res) => {
  try {
    const { name } = req.params
    await db.delete(secrets).where(eq(secrets.name, name))
    deleteSecretCache(name)
    res.json({ success: true })
  } catch (_error) {
    res.status(500).json({ error: 'Failed to delete secret' })
  }
})
