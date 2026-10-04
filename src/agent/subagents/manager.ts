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
    const registry = (await api.snapshot(
      Subagents,
      api.conversationId,
      callContext
    )) ?? { agents: {} as Record<string, Subagent> }
    if (Object.hasOwn(registry.agents, name))
      return { error: `${name} already exists; use send.` }

    await api.commit(async (tx: Tx) => {
      const state = await tx.doc(Subagents, api.conversationId)
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
      state.reporters[api.taskId as unknown as string] = await tx.createTask(
        Reporter,
        input,
        background
      )
    }, callContext)

    const current = (
      await api.snapshot(Subagents, api.conversationId, callContext)
    )?.agents[name]
    return { success: true, conversationId: current?.conversationId }
  },

  async send(
    api: ToolExecutionApi,
    callContext: Context,
    name: string,
    message: string,
    followUp?: boolean
  ) {
    const registry = (await api.snapshot(
      Subagents,
      api.conversationId,
      callContext
    )) ?? { agents: {} as Record<string, Subagent> }
    const agent = registry.agents[name]
    if (!agent) return { error: `No subagent named ${name}.` }

    await api.commit(async (tx: Tx) => {
      const state = await tx.doc(Subagents, api.conversationId)
      const background = {
        ownership: { kind: 'conversation' as const },
        background: true,
      } as const
      const conversationId = state.agents[name]?.conversationId
      const input = {
        name,
        conversationId,
        message,
        followUp: followUp === true,
      }
      state.reporters[api.taskId as unknown as string] = await tx.createTask(
        Reporter,
        input,
        background
      )
    }, callContext)

    return { success: true, conversationId: agent.conversationId }
  },
}
