import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import type { Models } from '@earendil-works/pi-ai'
import { createRegistry, Harness } from '@earendil-works/pi-durable'
import { openNodeSqliteStorage } from '@earendil-works/pi-durable/storage/sqlite/node'
import { createAttachmentExtension } from '../agent/attachments.ts'
import { ReminderExtension } from '../agent/reminders.ts'
import { SubagentExtension } from '../agent/subagents/tool.ts'
import { LaliExtension } from '../agent/tools.ts'
import { logger } from '../logger.ts'
import type { AttachmentStore } from '../services/attachments.ts'
import { durableStorageConfig } from '../storage/config.ts'
import { openLibsqlStorage } from '../storage/libsql.ts'

export async function setupDurableHarness(
  models: Models,
  attachments: AttachmentStore
) {
  const registry = createRegistry()
  registry.install(LaliExtension)
  registry.install(SubagentExtension)
  registry.install(ReminderExtension)
  registry.install(createAttachmentExtension(attachments, models))

  const storage = durableStorageConfig.url
    ? await openLibsqlStorage(
        durableStorageConfig.url,
        durableStorageConfig.authToken
      )
    : await openNodeSqliteStorage(durableStorageConfig.localPath)
  const harness = await Harness.open(
    storage,
    { models, registry },
    BACKGROUND_CONTEXT
  )
  logger.info('durable.ready', {
    backend: durableStorageConfig.url ? 'libsql' : 'node_sqlite',
  })

  // Recover saved work on boot, even when no browser submits a new message.
  harness.resume()
  return harness
}
