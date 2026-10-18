import type { Context } from '@earendil-works/chord'
import {
  configure,
  LiveDoc,
  type ToolExecutionApi,
  type Tx,
} from '@earendil-works/pi-durable'
import { Anchor, Reporter, type Subagent, Subagents } from './tasks.ts'
import { SubagentExtension } from './tool.ts'

export const SubagentManager = {
  async getStatus(api: ToolExecutionApi, callContext: Context, name?: string) {
    const registry = (await api.snapshot(
      Subagents,
      api.conversationId,
      callContext
    )) ?? { agents: {}, reporters: {} }
    const names = name === undefined ? Object.keys(registry.agents) : [name]
    const statuses = []
    for (const each of names) {
      const found = Object.hasOwn(registry.agents, each)
        ? registry.agents[each]
        : undefined
      if (found === undefined) continue
      const busy =
        (await api.snapshot(LiveDoc, found.conversationId, callContext))
          ?.run !== undefined
      statuses.push({ name: each, state: busy ? 'working' : 'idle' })
    }
    return statuses
  },

  async stop(api: ToolExecutionApi, callContext: Context, name: string) {
    const registry = (await api.snapshot(
      Subagents,
      api.conversationId,
      callContext
    )) ?? { agents: {} as Record<string, Subagent> }
    const agent = registry.agents[name]
    if (!agent) return { error: `No subagent named ${name}.` }

    await (await api.conversation(agent.conversationId, callContext))?.abort(
      callContext
    )
    return { success: true, conversationId: agent.conversationId }
  },

  async spawn(
    api: ToolExecutionApi,
    callContext: Context,
    name: string,
    message: string
  ) {
    return api.commit(async (tx: Tx) => {
      const state = await tx.doc(Subagents, api.conversationId)
      // The reporter and registry entry are committed together. Its key is the
      // tool task, not the name: a different spawn must still reject that name.
      if (Object.hasOwn(state.reporters, String(api.taskId)))
        return {
          success: true,
          conversationId: state.agents[name].conversationId,
        }
      if (Object.hasOwn(state.agents, name))
        return { error: `${name} already exists; use send.` }
      const background = {
        ownership: { kind: 'conversation' as const },
        background: true,
      } as const

      const anchor = await tx.createTask(Anchor, null, background)
      const child = await tx.createConversation({
        ownership: { kind: 'task' as const, taskId: anchor },
      })
      await configure(tx, child.id, {
        extensions: { remove: [SubagentExtension] },
        instructions: `You are the subagent "${name}". Answer the main agent's requests.`,
      })
      state.agents[name] = { conversationId: child.id, reported: [] }

      const input = {
        name,
        conversationId: child.id,
        message,
        followUp: false,
      }
      state.reporters[String(api.taskId)] = await tx.createTask(
        Reporter,
        input,
        background
      )
      return { success: true, conversationId: child.id }
    }, callContext)
  },

  async send(
    api: ToolExecutionApi,
    callContext: Context,
    name: string,
    message: string,
    followUp?: boolean
  ) {
    return api.commit(async (tx: Tx) => {
      const state = await tx.doc(Subagents, api.conversationId)
      const agent = Object.hasOwn(state.agents, name)
        ? state.agents[name]
        : undefined
      if (!agent) return { error: `No subagent named ${name}.` }
      if (Object.hasOwn(state.reporters, String(api.taskId)))
        return { success: true, conversationId: agent.conversationId }
      const background = {
        ownership: { kind: 'conversation' as const },
        background: true,
      } as const
      const conversationId = agent.conversationId
      const input = {
        name,
        conversationId,
        message,
        followUp: followUp === true,
      }
      state.reporters[String(api.taskId)] = await tx.createTask(
        Reporter,
        input,
        background
      )
      return { success: true, conversationId }
    }, callContext)
  },
}
