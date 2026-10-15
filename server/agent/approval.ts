import { defineDoc, defineTask, type TaskId } from '@earendil-works/pi-durable'
import { and, eq } from 'drizzle-orm'
import { db } from '../db/index.ts'
import { approvals } from '../db/schema.ts'

// The tool's owned wait and proposal are created together, so replay rejoins
// this decision rather than creating a second permission request.
export const ToolApproval = defineDoc<{ taskId?: TaskId<ApprovalDecision> }>({
  kind: 'lali.tool-approval',
  version: 1,
  scope: 'task',
  initial: () => ({}),
})

type ApprovalDecision = 'approved' | 'rejected'
export const ApprovalTask = defineTask<
  { approvalId: string; userId: string },
  { phase: 'decision' },
  ApprovalDecision
>({
  name: 'lali.approval',
  version: 1,
  initial: () => ({ phase: 'decision' }),
  phases: {
    decision: async (task, runtime, context) => {
      // App SQL is the decision's source of truth. Reading it avoids a second
      // cross-database "delivered" flag that could be lost between commits.
      // Pi owns cancellation and restart of this wait, not the browser.
      for (;;) {
        runtime.signal.throwIfAborted()
        const [approval] = await db
          .select()
          .from(approvals)
          .where(
            and(
              eq(approvals.id, task.input.approvalId),
              eq(approvals.userId, task.input.userId)
            )
          )
        if (!approval) throw new Error('Approval request is unavailable.')
        if (approval.action !== `clear_todos:${runtime.conversationId}`)
          throw new Error('Approval belongs to another conversation.')
        if (approval.status === 'approved' || approval.status === 'rejected') {
          const decision = approval.status
          await runtime.commit(async tx => {
            await tx.appendEntry(runtime.conversationId, {
              kind: 'lali.approval',
              data: {
                id: approval.id,
                status: decision,
                summary: 'Clear pending todos',
              },
            })
            return {
              status: 'terminal',
              outcome: { status: 'completed', result: decision },
            }
          }, context)
          return
        }
        await runtime.sleep(runtime.now() + 250, context)
      }
    },
  },
  abort: async (task, runtime, context) => {
    await db
      .update(approvals)
      .set({ status: 'interrupted' })
      .where(
        and(
          eq(approvals.id, task.input.approvalId),
          eq(approvals.userId, task.input.userId),
          eq(approvals.status, 'pending')
        )
      )
    await runtime.commit(async tx => {
      await tx.appendEntry(runtime.conversationId, {
        kind: 'lali.approval',
        data: {
          id: task.input.approvalId,
          status: 'interrupted',
          summary: 'Approval wait cancelled',
        },
      })
      return { status: 'terminal', outcome: { status: 'aborted' } }
    }, context)
  },
})
