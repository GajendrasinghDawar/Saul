import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import type { Usage } from '@earendil-works/pi-ai'
import {
  type ConversationId,
  type Harness,
  UsageDoc,
} from '@earendil-works/pi-durable'
import { getUserConversationIds } from '../agent/data.ts'

export type UsageOverview = {
  generatedAt: string
  scope: 'owned-conversations'
  conversationCount: number
  totals: Usage
  models: Array<{
    key: string
    usage: Usage
    costStatus: 'estimated' | 'unknown'
  }>
  tools: Array<{ name: string; usage: Usage }>
  unknownPricingModels: number
}

function zeroUsage(): Usage {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  }
}

function addUsage(total: Usage, usage: Usage) {
  for (const key of [
    'input',
    'output',
    'cacheRead',
    'cacheWrite',
    'totalTokens',
  ] as const) {
    if (!Number.isFinite(usage[key]) || usage[key] < 0)
      throw new Error('Invalid usage ledger')
    total[key] += usage[key]
  }
  for (const key of ['reasoning', 'cacheWrite1h'] as const) {
    if (usage[key] !== undefined) {
      if (!Number.isFinite(usage[key]) || usage[key] < 0)
        throw new Error('Invalid usage ledger')
      total[key] = (total[key] ?? 0) + usage[key]
    }
  }
  for (const key of [
    'input',
    'output',
    'cacheRead',
    'cacheWrite',
    'total',
  ] as const) {
    if (!Number.isFinite(usage.cost[key]) || usage.cost[key] < 0)
      throw new Error('Invalid usage ledger')
    total.cost[key] += usage.cost[key]
  }
}

export class UsageService {
  private harness: Harness

  constructor(harness: Harness) {
    this.harness = harness
  }

  async getOverview(userId: string): Promise<UsageOverview> {
    const modelUsage = new Map<string, Usage>()
    const toolUsage = new Map<string, Usage>()
    let conversationCount = 0
    for (const id of await getUserConversationIds(userId)) {
      const numericId = Number(id)
      if (!Number.isSafeInteger(numericId) || numericId < 1)
        throw new Error('Invalid conversation ID')
      const conversation = await this.harness.conversation(
        numericId as ConversationId,
        BACKGROUND_CONTEXT
      )
      if (!conversation) continue
      // Each read is a short snapshot, not one transaction locking the entire account.
      // The native ledger includes compaction spend and excludes inherited fork history.
      // Installed Pi Durable exposes this ledger through snapshot(), not Conversation.usage().
      const ledger = await this.harness.snapshot(
        UsageDoc,
        conversation.id,
        BACKGROUND_CONTEXT
      )
      if (ledger === undefined) {
        conversationCount++
        continue
      }
      for (const [bucket, target] of [
        [ledger.models, modelUsage],
        [ledger.tools, toolUsage],
      ] as const) {
        for (const [key, usage] of Object.entries(bucket)) {
          const total = target.get(key) ?? zeroUsage()
          addUsage(total, usage)
          target.set(key, total)
        }
      }
      conversationCount++
    }
    // Current catalog rates cannot establish the price of historical activity.
    // Keep native keys whole: custom provider and model IDs may contain '/'.
    const totals = zeroUsage()
    const models: UsageOverview['models'] = [...modelUsage]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, usage]) => {
        addUsage(totals, usage)
        return {
          key,
          usage,
          costStatus: Object.values(usage.cost).some(cost => cost > 0)
            ? 'estimated'
            : 'unknown',
        }
      })
    return {
      generatedAt: new Date().toISOString(),
      scope: 'owned-conversations',
      conversationCount,
      totals,
      models,
      tools: [...toolUsage]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([name, usage]) => ({ name, usage })),
      unknownPricingModels: models.filter(
        model => model.costStatus === 'unknown'
      ).length,
    }
  }
}
