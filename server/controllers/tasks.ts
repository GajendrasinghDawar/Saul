import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import type { Request, Response } from 'express'
import type { AppDependencies } from '../app.ts'
import { errorCategory, logger } from '../logger.ts'
import { TaskService } from '../services/tasks.ts'

export function createTasksController({ harness }: AppDependencies) {
  const taskService = new TaskService(harness)

  return {
    async streamTasks(_req: Request, res: Response) {
      const watch = await harness.watchTaskGraph(BACKGROUND_CONTEXT)
      if (res.destroyed) {
        await watch.stop()
        return
      }
      res.setHeader('Content-Type', 'text/event-stream')
      res.setHeader('Cache-Control', 'no-cache, no-transform')
      res.setHeader('X-Accel-Buffering', 'no')
      res.flushHeaders()
      let previous = ''
      const heartbeat = setInterval(() => {
        if (!res.destroyed && !res.writableEnded && res.writableLength === 0)
          res.write(': keepalive\n\n')
      }, 15_000)
      const close = () => {
        clearInterval(heartbeat)
        void watch.stop()
      }
      res.once('close', close)
      const send = async () => {
        // Recheck app ownership for every snapshot; never broadcast the session-wide graph.
        const message = JSON.stringify({
          tasks: await taskService.getUserTasks(String(res.locals.userId)),
        })
        if (res.destroyed || res.writableEnded || message === previous) return
        previous = message
        if (!res.write(`data: ${message}\n\n`)) {
          await new Promise<void>(resolve => {
            const done = () => {
              res.off('drain', done)
              res.off('close', done)
              resolve()
            }
            res.once('drain', done)
            res.once('close', done)
          })
        }
      }
      void watch.closed.then(end => {
        clearInterval(heartbeat)
        if (end.reason === 'listener_error')
          logger.error('tasks.stream_failed', {
            category: errorCategory(end.error),
          })
        res.end()
      })
      try {
        await send()
        watch.start(send)
      } catch (error) {
        logger.error('tasks.stream_failed', { category: errorCategory(error) })
        close()
        res.end()
      }
    },

    async listTasks(_req: Request, res: Response) {
      const userId = res.locals.userId
      const tasks = await taskService.getUserTasks(userId)
      res.json({ tasks })
    },

    async attention(_req: Request, res: Response) {
      res.setHeader('Cache-Control', 'no-store')
      res.json(await taskService.getAttention(res.locals.userId))
    },

    async getApproval(req: Request, res: Response) {
      res.setHeader('Cache-Control', 'no-store')
      const approval = await taskService.getApproval(
        String(req.params.id),
        res.locals.userId
      )
      if (!approval)
        return res.status(404).json({ error: 'Approval not found' })
      res.json({
        approval: {
          id: approval.id,
          action: approval.action.split(':')[0],
          detail: approval.detail,
          status: approval.status,
        },
      })
    },

    async approveAction(req: Request, res: Response) {
      const id = String(req.params.id)
      const userId = res.locals.userId

      const updated = await taskService.setApprovalStatus(
        id,
        userId,
        'approved'
      )
      if (updated === 'conflict')
        return res
          .status(409)
          .json({ error: 'This approval was already decided.' })
      if (updated === 'not_found')
        return res
          .status(404)
          .json({ error: 'Approval request not found or unauthorized' })

      res.json({ success: true })
    },

    async rejectAction(req: Request, res: Response) {
      const id = String(req.params.id)
      const userId = res.locals.userId

      const updated = await taskService.setApprovalStatus(
        id,
        userId,
        'rejected'
      )
      if (updated === 'conflict')
        return res
          .status(409)
          .json({ error: 'This approval was already decided.' })
      if (updated === 'not_found')
        return res
          .status(404)
          .json({ error: 'Approval request not found or unauthorized' })

      res.json({ success: true })
    },

    async abortTask(req: Request, res: Response) {
      const taskId = String(req.params.taskId)
      const userId = res.locals.userId

      const status = await taskService.abortTask(taskId, userId)

      if (status === 'not_found')
        return res.status(404).json({ error: 'Task not found' })
      if (status === 'forbidden')
        return res.status(403).json({ error: 'Forbidden' })

      res.json({ success: true })
    },
  }
}
