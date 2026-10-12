import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import { Router } from 'express'
import {
  deleteUserConversation,
  getUserConversations,
  renameConversation,
} from '../agent/data.ts'
import type { AppDependencies } from '../app.ts'

export function createConversationsRouter({ harness }: AppDependencies) {
  const router = Router()

  router.get('/', async (_req, res) => {
    const userId = res.locals.userId
    const userConvs = await getUserConversations(userId)
    const userConvIds = userConvs.map(c => c.conversationId)
    const titlesMap = Object.fromEntries(
      userConvs.map(c => [c.conversationId, c.title])
    )

    const result = await harness.commit(async tx => {
      return tx.scanConversations({}, 100, undefined)
    }, BACKGROUND_CONTEXT)

    const userConversationsList = result.items
      .filter(c => userConvIds.includes(String(c.id)))
      .map(c => ({
        ...c,
        id: String(c.id),
        title: titlesMap[String(c.id)] || undefined,
      }))

    res.json({ conversations: userConversationsList })
  })

  router.patch('/:id', async (req, res) => {
    const userId = res.locals.userId
    const { id } = req.params
    const { title } = req.body || {}

    if (!title) {
      res.status(400).json({ error: 'Title is required' })
      return
    }

    try {
      await renameConversation(id, userId, title)
      res.json({ success: true })
    } catch (e: unknown) {
      console.error('Rename error:', e)
      if (e instanceof Error && e.message === 'Not authorized') {
        res.status(403).json({ error: 'Not authorized' })
      } else {
        res.status(500).json({ error: 'Internal server error' })
      }
    }
  })

  router.delete('/:id', async (req, res) => {
    const userId = res.locals.userId
    const { id } = req.params

    try {
      await deleteUserConversation(id, userId)
      res.json({ success: true })
    } catch (e: unknown) {
      console.error('Delete error:', e)
      if (e instanceof Error && e.message === 'Not authorized') {
        res.status(403).json({ error: 'Not authorized' })
      } else {
        res.status(500).json({ error: 'Internal server error' })
      }
    }
  })

  return router
}
