import type { Request, Response } from 'express'
import type { AppDependencies } from '../app.ts'
import { TaskService } from '../services/tasks.ts'

export function createTasksController({ harness }: AppDependencies) {
  const taskService = new TaskService(harness)

  return {
    async listTasks(_req: Request, res: Response) {
      const userId = res.locals.userId
      const tasks = await taskService.getUserTasks(userId)
      res.json({ tasks })
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
