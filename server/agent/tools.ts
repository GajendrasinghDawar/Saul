import { Type } from '@earendil-works/pi-ai'
import {
  defineExtension,
  defineTool,
  hook,
  section,
  ToolTask,
} from '@earendil-works/pi-durable'
import { sql } from 'drizzle-orm'
import { Resend } from 'resend'
import { db } from '../db/index.ts'
import { todos } from '../db/schema.ts'
import { getSecret } from '../secretsManager.ts'
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
    const proposalId = await api.memo<string>('todo-clear-approval', ctx)
    if (!proposalId) throw new Error('A new approval is required.')
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
  tools: [saveTodoTool, clearTodosTool, sendDigestEmailTool],
  hooks: [
    hook(ToolTask, {
      // beforeTool intercepts the tool execution. It's useful for injecting approval flows.
      beforeTool: async (call, api, ctx) => {
        if (call.name === 'clear_todos') {
          // Bind this durable task to one permission, including after restart.
          if (await api.memo<string>('todo-clear-approval', ctx)) return {}
          const userId = await getUserIdForConversation(
            String(api.conversationId)
          )

          const proposal = await requestTodoClear(
            userId,
            String(api.conversationId)
          )
          if (proposal.status !== 'approved') {
            return {
              block: `[APPROVAL REQUIRED] Proposal ID: ${proposal.id}. Please wait for the user to approve this action via the UI.`,
            }
          }
          await api.memo('todo-clear-approval', proposal.id, ctx)
        }

        return {} // Let other tools pass normally
      },
    }),
  ],
})
