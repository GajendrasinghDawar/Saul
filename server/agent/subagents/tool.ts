import { Type } from '@earendil-works/pi-ai'
import {
  type ConversationId,
  defineExtension,
  defineTool,
} from '@earendil-works/pi-durable'
import { SubagentManager } from './manager.ts'
import { Anchor, Reporter } from './tasks.ts'

export const subagentTool = defineTool({
  name: 'manage_subagents',
  description:
    'Manage persistent subagents that work in the background. Actions: spawn (name, message), send (name, message; ' +
    'followUp: true queues it after the current answer instead of steering), ' +
    'status (name, or all subagents without one). Use stop_subagent to cancel work. Answers are reported back to you when they arrive.',
  parameters: Type.Object({
    action: Type.Union([
      Type.Literal('spawn'),
      Type.Literal('send'),
      Type.Literal('status'),
    ]),
    name: Type.Optional(Type.String()),
    message: Type.Optional(Type.String()),
    followUp: Type.Optional(Type.Boolean()),
  }),
  replay: 'safe',
  execute: async (args, api, callContext) => {
    const { action, name, message, followUp } = args
    const reply = (text: string, conversationId?: ConversationId) => ({
      output: [{ type: 'text' as const, text }],
      ...(conversationId === undefined || name === undefined
        ? {}
        : { details: { name, conversationId } }),
    })

    if (action === 'status') {
      const statuses = await SubagentManager.getStatus(api, callContext, name)
      if (statuses.length === 0) return reply('No subagents.')
      return reply(statuses.map(s => `${s.name}: ${s.state}`).join('\n'))
    }

    if (name === undefined) return reply(`${action} needs a name.`)

    if (message === undefined) return reply(`${action} needs a message.`)

    if (action === 'spawn') {
      const res = await SubagentManager.spawn(api, callContext, name, message)
      if (res.error) return reply(res.error)
      return reply(`Started ${name}.`, res.conversationId)
    }

    if (action === 'send') {
      const res = await SubagentManager.send(
        api,
        callContext,
        name,
        message,
        followUp
      )
      if (res.error) return reply(res.error)
      return reply(`Sent to ${name}.`, res.conversationId)
    }

    return reply(`Unknown action: ${action}`)
  },
})

export const stopSubagentTool = defineTool({
  name: 'stop_subagent',
  description:
    'Stop the named subagent’s current work. The subagent remains available for later messages.',
  parameters: Type.Object({ name: Type.String() }),
  // Repeating an already completed abort could cancel newer work. Cancellation
  // is intentionally separate from replay-safe spawn/send operations.
  replay: 'unsafe',
  execute: async ({ name }, api, context) => {
    const result = await SubagentManager.stop(api, context, name)
    return {
      output: [{ type: 'text', text: result.error ?? `Stopped ${name}.` }],
      ...(result.conversationId === undefined
        ? {}
        : { details: { name, conversationId: result.conversationId } }),
    }
  },
})

export const SubagentExtension = defineExtension({
  name: 'subagent-tools',
  tasks: [Anchor, Reporter],
  tools: [subagentTool, stopSubagentTool],
})
