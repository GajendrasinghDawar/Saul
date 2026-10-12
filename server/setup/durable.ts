import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import type { Models } from '@earendil-works/pi-ai'
import { createRegistry, Harness } from '@earendil-works/pi-durable'
import { openNodeSqliteStorage } from '@earendil-works/pi-durable/storage/sqlite/node'
import { ReminderExtension } from '../agent/reminders.ts'
import { SubagentExtension } from '../agent/subagents/tool.ts'
import { LaliExtension } from '../agent/tools.ts'

export async function setupDurableHarness(models: Models) {
  const registry = createRegistry()
  registry.install(LaliExtension)
  registry.install(SubagentExtension)
  registry.install(ReminderExtension)

  const storage = await openNodeSqliteStorage('./data/lali-durable.sqlite')
  const harness = await Harness.open(
    storage,
    { models, registry },
    BACKGROUND_CONTEXT
  )
  console.log('Pi Durable Harness Booted !!')

  return harness
}
