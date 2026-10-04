import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import { Router } from 'express'
import { getUserConversationIds } from '../agent/data.ts'
import type { AppDependencies } from '../app.ts'

export function createTasksRouter({ harness }: AppDependencies) {
  const router = Router()

  router.get('/', async (_req, res) => {
    const userId = res.locals.userId
    const userConvIds = await getUserConversationIds(userId)

    const result = await harness.commit(async tx => {
      return tx.scanTasks({}, 100, undefined)
    }, BACKGROUND_CONTEXT)

    const userTasks = result.items.filter(t =>
      userConvIds.includes(String(t.conversationId))
    )
    res.json({ tasks: userTasks })
  })

  router.post('/approvals/:id/approve', async (req, res) => {
    const { id } = req.params
    const userId = res.locals.userId
    const { db } = await import('../db/index.ts')
    const { approvals } = await import('../db/schema.ts')
    const { sql } = await import('drizzle-orm')

    await db
      .update(approvals)
      .set({ status: 'approved' })
      .where(sql`${approvals.id} = ${id} AND ${approvals.userId} = ${userId}`)

    res.json({ success: true })
  })

  router.post('/approvals/:id/reject', async (req, res) => {
    const { id } = req.params
    const userId = res.locals.userId
    const { db } = await import('../db/index.ts')
    const { approvals } = await import('../db/schema.ts')
    const { sql } = await import('drizzle-orm')

    await db
      .update(approvals)
      .set({ status: 'rejected' })
      .where(sql`${approvals.id} = ${id} AND ${approvals.userId} = ${userId}`)

    res.json({ success: true })
  })

  router.post('/:taskId/abort', async (req, res) => {
    const { taskId } = req.params
    const userId = res.locals.userId
    const userConvIds = await getUserConversationIds(userId)

    await harness
      .commit(async tx => {
        const task = await tx.task(
          taskId as unknown as import('@earendil-works/pi-durable').TaskId
        )
        if (!task) throw new Error('Task not found')
        if (!userConvIds.includes(String(task.conversationId))) {
          throw new Error('Forbidden')
        }
        // Assuming tx has abortTask. Actually, harness has abortTask!
      }, BACKGROUND_CONTEXT)
      .catch(_e => {
        // Just a quick catch
      })

    // Actually, harness.abortTask is available directly on harness.
    // Let's just do that. Wait, we need to check ownership first.
    const task = await harness.commit(
      async tx =>
        tx.task(
          taskId as unknown as import('@earendil-works/pi-durable').TaskId
        ),
      BACKGROUND_CONTEXT
    )
    if (!task) return res.status(404).json({ error: 'Task not found' })
    if (!userConvIds.includes(String(task.conversationId))) {
      return res.status(403).json({ error: 'Forbidden' })
    }

    await harness.abortTask(
      taskId as unknown as import('@earendil-works/pi-durable').TaskId,
      BACKGROUND_CONTEXT
    )

    res.json({ success: true })
  })

  return router
}
