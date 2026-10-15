import { Type } from '@earendil-works/pi-ai'
import {
  defineExtension,
  defineTool,
  GenerationTask,
  hook,
  section,
  ToolTask,
} from '@earendil-works/pi-durable'
import { sql } from 'drizzle-orm'
import { Resend } from 'resend'
import { db } from '../db/index.ts'
import { todos } from '../db/schema.ts'
import { errorCategory, logger } from '../logger.ts'
import { getSecret } from '../secretsManager.ts'
import { ApprovalTask, ToolApproval } from './approval.ts'
import {
  DEFAULT_EMAIL_FROM,
  DEFAULT_EMAIL_SUBJECT,
  SYSTEM_PROMPT,
} from './constants.ts'
import {
  clearTodos,
  getUserIdForConversation,
  requestTodoClear,
  saveTodo,
} from './data.ts'

export const saveTodoTool = defineTool({
  name: 'save_todo',
  description: 'Save a new task or reminder for the user.',
  parameters: Type.Object({ task: Type.String() }),
  // replay: "safe" means it is safe to rerun this tool after a crash mid-flight
  // because saving the exact same todo twice might be acceptable or idempotent.
  replay: 'safe',
  execute: async (args, api) => {
    const userId = await getUserIdForConversation(String(api.conversationId))
    await saveTodo(String(api.taskId), userId, args.task)
    api.output(`Saved TODO: ${args.task}\n`)
    return {
      content: [{ type: 'text', text: `Success: Saved "${args.task}"` }],
    }
  },
})

export const clearTodosTool = defineTool({
  name: 'clear_todos',
  description: 'Clear all pending todos from the database.',
  parameters: Type.Object({}),
  replay: 'safe',
  execute: async (_args, api, ctx) => {
    const userId = await getUserIdForConversation(String(api.conversationId))
    const proposalId = await api.memo(
      'todo-clear-approval',
      `todo-clear-${api.taskId}`,
      ctx
    )
    const proposal = await requestTodoClear(
      userId,
      String(api.conversationId),
      proposalId
    )
    // Permission already consumed by a previous execution is safe to replay.
    if (proposal.status !== 'consumed') {
      const waitTask = await api.commit(async tx => {
        const state = await tx.doc(ToolApproval, api.taskId)
        if (!state.taskId) {
          state.taskId = await tx.createTask(
            ApprovalTask,
            { approvalId: proposalId, userId },
            {
              ownership: { kind: 'task', taskId: api.taskId },
            }
          )
          await tx.appendEntry(api.conversationId, {
            kind: 'lali.approval',
            data: {
              id: proposalId,
              status: 'pending',
              summary: 'Clear pending todos',
            },
          })
        }
        return state.taskId
      }, ctx)
      api.output('Waiting for your approval in Attention.\n')
      const receipt = await api.waitForTask(waitTask, ctx)
      if (receipt.state.outcome.status !== 'completed')
        throw new Error('Approval wait did not complete.')
      if (receipt.state.outcome.result === 'rejected')
        return {
          content: [
            {
              type: 'text',
              text: 'The user rejected clearing todos. No todos were changed. Continue without performing this action.',
            },
          ],
        }
    }
    await clearTodos(userId, String(api.conversationId), proposalId)
    api.output(`Cleared all pending todos\n`)
    return { content: [{ type: 'text', text: 'Success: Cleared all todos.' }] }
  },
})

export const sendDigestEmailTool = defineTool({
  name: 'send_digest_email',
  description: "Send an email summary of the user's pending tasks.",
  parameters: Type.Object({ body: Type.String() }),
  // replay: "none", meaning it will NOT rerun if it crashes mid-flight. Safe from double-sending!
  execute: async (args, api) => {
    api.output(`Sending email...\n`)

    const emailKey = getSecret('RESEND_API_KEY')
    if (!emailKey) {
      if (process.env.NODE_ENV === 'production') {
        throw new Error(
          'RESEND_API_KEY is required in production to send emails.'
        )
      }
      api.output(`[Mock Email] ${args.body}\n`)
      return {
        content: [{ type: 'text', text: 'Email sent successfully (mocked).' }],
      }
    }

    const resend = new Resend(emailKey)

    // We use the api.taskId as our Idempotency Key!
    const { data, error } = await resend.emails.send({
      from: DEFAULT_EMAIL_FROM,
      to: getSecret('MY_EMAIL_ADDRESS', 'delivered@resend.dev'),
      subject: DEFAULT_EMAIL_SUBJECT,
      text: args.body,
      headers: { 'Idempotency-Key': String(api.taskId) },
    })

    if (error) throw new Error(error.message)
    api.output(`Sent email ID: ${data?.id}\n`)
    return {
      content: [
        { type: 'text', text: `Email sent successfully! ID: ${data?.id}` },
      ],
    }
  },
})

// We bundle the tools and the prompt into an Extension
export const LaliExtension = defineExtension({
  name: 'lali',
  sections: [
    section('preamble', () => SYSTEM_PROMPT, { tag: false }),
    section('world_state', async input => {
      // Inject the live database state into the system prompt!
      // This allows the agent to always have the latest context without querying.
      const userId = await getUserIdForConversation(
        String(input.conversationId)
      )
      const currentTodos = await db
        .select()
        .from(todos)
        .where(sql`${todos.status} = 'pending' AND ${todos.userId} = ${userId}`)
      return `Current Todos:\n${JSON.stringify(currentTodos, null, 2)}`
    }),
  ],
  tasks: [ApprovalTask],
  tools: [saveTodoTool, clearTodosTool, sendDigestEmailTool],
  hooks: [
    hook(GenerationTask, {
      beforeRequest: (_request, api) => {
        logger.info('agent.request', {
          conversationId: api.conversationId,
          taskId: api.taskId,
        })
      },
      afterResponse: (message, api) => {
        const fields = {
          conversationId: api.conversationId,
          taskId: api.taskId,
          provider: message.provider,
          model: message.model,
          stopReason: message.stopReason,
        }
        if (message.stopReason === 'error') {
          logger.error('agent.response_failed', {
            ...fields,
            category: errorCategory(message.errorMessage),
          })
        } else {
          logger.info('agent.response', fields)
        }
      },
    }),
    hook(ToolTask, {
      afterTool: (_call, result, api) => {
        logger[result.isError ? 'warn' : 'info']('agent.tool_result', {
          conversationId: api.conversationId,
          taskId: api.taskId,
          failed: Boolean(result.isError),
        })
      },
    }),
  ],
})
