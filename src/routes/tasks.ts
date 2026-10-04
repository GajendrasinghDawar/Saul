import { Router } from 'express'
import type { AppDependencies } from '../app.ts'
import { createTasksController } from '../controllers/tasks.ts'

export function createTasksRouter(dependencies: AppDependencies) {
  const router = Router()
  const controller = createTasksController(dependencies)

  // List all tasks belonging to the user
  router.get('/', controller.listTasks)

  // Approve a pending action
  router.post('/approvals/:id/approve', controller.approveAction)

  // Reject a pending action
  router.post('/approvals/:id/reject', controller.rejectAction)

  // Abort a running task
  router.post('/:taskId/abort', controller.abortTask)

  return router
}
