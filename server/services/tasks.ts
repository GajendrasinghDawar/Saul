import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import type { Harness, TaskId } from '@earendil-works/pi-durable'
import { sql } from 'drizzle-orm'
import { getUserConversationIds } from '../agent/data.ts'
import { db } from '../db/index.ts'
import { approvals } from '../db/schema.ts'

export class TaskService {
  harness: Harness

  constructor(harness: Harness) {
    this.harness = harness
  }

  async getUserTasks(userId: string) {
    const userConvIds = await getUserConversationIds(userId)

    const result = await this.harness.commit(async tx => {
      return tx.scanTasks({}, 100, undefined)
    }, BACKGROUND_CONTEXT)

    // Filter tasks down to only those that belong to the user's conversations
    return result.items.filter(t =>
      userConvIds.includes(String(t.conversationId))
    )
  }

  async setApprovalStatus(
    id: string,
    userId: string,
    status: 'approved' | 'rejected'
  ) {
    const result = await db
      .update(approvals)
      .set({ status })
      .where(sql`${approvals.id} = ${id} AND ${approvals.userId} = ${userId}`)
      .returning()

    return result.length > 0
  }

  async abortTask(
    taskIdStr: string,
    userId: string
  ): Promise<'not_found' | 'forbidden' | 'success'> {
    const taskId = taskIdStr as unknown as TaskId
    const userConvIds = await getUserConversationIds(userId)

    const task = await this.harness.commit(
      async tx => tx.task(taskId),
      BACKGROUND_CONTEXT
    )

    if (!task) return 'not_found'
    if (!userConvIds.includes(String(task.conversationId))) return 'forbidden'

    await this.harness.abortTask(taskId, BACKGROUND_CONTEXT)
    return 'success'
  }
}
