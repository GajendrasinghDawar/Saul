import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import type { Harness, TaskId } from '@earendil-works/pi-durable'
import { sql } from 'drizzle-orm'
import { getUserConversationIds } from '../agent/data.ts'
import { db } from '../db/index.ts'
import { approvals } from '../db/schema.ts'
import {
  type AttentionResponse,
  attentionSource,
  scanOwnedTasks,
  taskAttention,
} from './attention.ts'

export class TaskService {
  harness: Harness

  constructor(harness: Harness) {
    this.harness = harness
  }

  async getUserTasks(userId: string) {
    const userConvIds = await getUserConversationIds(userId)

    const tasks = await this.harness.commit(
      tx => scanOwnedTasks(tx, userConvIds),
      BACKGROUND_CONTEXT
    )
    return tasks.map(task => ({
      id: task.id,
      kind: task.kind,
      conversationId: task.conversationId,
      abortRequested: task.abortRequested,
      state: {
        status: task.state.status,
        ...(task.state.outcome
          ? { outcome: { status: task.state.outcome.status } }
          : {}),
      },
    }))
  }

  async getAttention(userId: string): Promise<AttentionResponse> {
    const now = Date.now()
    const conversationIds = await getUserConversationIds(userId)
    const pending = await db
      .select()
      .from(approvals)
      .where(
        sql`${approvals.userId} = ${userId} AND ${approvals.status} = 'pending'`
      )
    const tasks = await this.harness.commit(
      async tx =>
        taskAttention(tx, await scanOwnedTasks(tx, conversationIds), now),
      BACKGROUND_CONTEXT
    )
    const response: AttentionResponse = {
      generatedAt: new Date(now).toISOString(),
      groups: {
        approvals: pending.map(approval => {
          const conversationId = approval.action.startsWith('clear_todos:')
            ? approval.action.slice('clear_todos:'.length)
            : null
          return {
            id: `approval:${approval.id}`,
            type: 'approval',
            approvalId: approval.id,
            title: conversationId
              ? 'Clear pending todos?'
              : 'Approval requested',
            text: conversationId
              ? 'Clear all pending todos, including new todos at execution time. Your decision automatically continues the waiting agent in the source chat.'
              : 'Review this request in its source before deciding.',
            timestamp: null,
            source:
              conversationId && conversationIds.includes(conversationId)
                ? attentionSource(conversationId)
                : null,
          }
        }),
        ...tasks,
      },
    }
    for (const items of Object.values(response.groups))
      items.sort(
        (a, b) =>
          (b.timestamp ?? '').localeCompare(a.timestamp ?? '') ||
          a.id.localeCompare(b.id)
      )
    return response
  }

  async getApproval(id: string, userId: string) {
    const [approval] = await db
      .select()
      .from(approvals)
      .where(sql`${approvals.id} = ${id} AND ${approvals.userId} = ${userId}`)
    return approval
  }

  async setApprovalStatus(
    id: string,
    userId: string,
    status: 'approved' | 'rejected'
  ) {
    const result = await db
      .update(approvals)
      .set({ status })
      .where(
        sql`${approvals.id} = ${id} AND ${approvals.userId} = ${userId} AND ${approvals.status} = 'pending'`
      )
      .returning()

    if (result.length > 0) {
      this.harness.resume()
      return 'success'
    }
    return (await this.getApproval(id, userId)) ? 'conflict' : 'not_found'
  }

  async abortTask(
    taskIdStr: string,
    userId: string
  ): Promise<'not_found' | 'forbidden' | 'success'> {
    const numericId = Number(taskIdStr)
    if (!Number.isSafeInteger(numericId) || numericId < 1) return 'not_found'
    const taskId = numericId as TaskId
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
