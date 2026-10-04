import type { AssistantMessage } from '@earendil-works/pi-ai'
import {
  AssistantEntry,
  type ConversationId,
  defineDoc,
  defineTask,
  type EntryId,
  type TaskId,
} from '@earendil-works/pi-durable'

export type Subagent = {
  conversationId: ConversationId
  reported: EntryId[]
}

export const Subagents = defineDoc<{
  agents: Record<string, Subagent>
  reporters: Record<string, TaskId>
}>({
  kind: 'lali.subagents',
  version: 1,
  scope: 'conversation',
  history: 'latest',
  fork: 'initial',
  initial: () => ({ agents: {}, reporters: {} }),
})

export const Anchor = defineTask<null, { phase: 'done' }, null>({
  name: 'lali.subagent-anchor',
  version: 1,
  initial: () => ({ phase: 'done' }),
  phases: {
    done: (_anchor, runtime, taskContext) =>
      runtime.commit(
        () => ({
          status: 'terminal',
          outcome: { status: 'completed', result: null },
        }),
        taskContext
      ),
  },
  abort: (_anchor, runtime, taskContext) =>
    runtime.commit(
      () => ({ status: 'terminal', outcome: { status: 'aborted' } }),
      taskContext
    ),
})

export type ReporterInput = {
  name: string
  conversationId: ConversationId
  message: string
  followUp: boolean
}
export type ReporterState =
  | { phase: 'deliver' }
  | { phase: 'report'; report?: string }

export const Reporter = defineTask<ReporterInput, ReporterState, null>({
  name: 'lali.subagent-reporter',
  version: 1,
  initial: () => ({ phase: 'deliver' }),
  phases: {
    deliver: async (reporter, runtime, taskContext) => {
      const { name, conversationId, message, followUp } = reporter.input
      const subagent = (await runtime.conversation(
        conversationId,
        taskContext
      ))!
      const request = {
        type: 'input',
        content: message,
        whenBusy: followUp ? 'followUp' : 'steer',
      } as const
      const submission = await subagent.submit(
        { ...request, requestId: `subagent:${reporter.id}` },
        taskContext
      )
      const settled = await submission.wait(taskContext)
      await runtime.commit(async tx => {
        const next = (report?: string) =>
          ({
            status: 'running',
            checkpoint: { phase: 'report', report },
          }) as const
        if (settled.status === 'unanswered') {
          return next(
            settled.reason === 'aborted'
              ? undefined
              : `[subagent ${name} failed: ${settled.reason}]`
          )
        }
        if (settled.type !== 'input') return next()
        const agent = (await tx.doc(Subagents, runtime.conversationId)).agents[
          name
        ]!
        if (agent.reported.includes(settled.answer)) return next()
        agent.reported.push(settled.answer)
        const answer = (await tx.entry(AssistantEntry, settled.answer))
          ?.model?.[0] as AssistantMessage
        return next(
          `[subagent ${name} answered, no reply needed] ${textOf(answer)}`
        )
      }, taskContext)
    },
    report: async (reporter, runtime, taskContext) => {
      const report = reporter.state.checkpoint.report
      if (report !== undefined) {
        const main = (await runtime.conversation(
          runtime.conversationId,
          taskContext
        ))!
        const input = {
          type: 'input',
          content: report,
          whenBusy: 'followUp',
        } as const
        await main.submit(
          { ...input, requestId: `subagent-report:${reporter.id}` },
          taskContext
        )
      }
      await runtime.commit(
        () => ({
          status: 'terminal',
          outcome: { status: 'completed', result: null },
        }),
        taskContext
      )
    },
  },
  abort: (_reporter, runtime, taskContext) =>
    runtime.commit(
      () => ({ status: 'terminal', outcome: { status: 'aborted' } }),
      taskContext
    ),
})

export function textOf(message: AssistantMessage | undefined): string {
  return (message?.content ?? [])
    .flatMap(c => (c.type === 'text' ? [c.text] : []))
    .join('')
}
