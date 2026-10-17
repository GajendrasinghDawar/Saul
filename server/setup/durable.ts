import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import type { Models } from '@earendil-works/pi-ai'
import {
  AgentDoc,
  configure,
  createRegistry,
  defineDoc,
  Harness,
} from '@earendil-works/pi-durable'
import { openNodeSqliteStorage } from '@earendil-works/pi-durable/storage/sqlite/node'
import { createAttachmentExtension } from '../agent/attachments.ts'
import { ReminderExtension } from '../agent/reminders.ts'
import { SubagentExtension } from '../agent/subagents/tool.ts'
import { LaliExtension } from '../agent/tools.ts'
import { errorCategory, logger } from '../logger.ts'
import type { AttachmentStore } from '../services/attachments.ts'
import { durableStorageConfig } from '../storage/config.ts'
import { openLibsqlStorage } from '../storage/libsql.ts'

const AzureProviderMigration = defineDoc<{ done?: true }>({
  kind: 'saul.azure-provider-migration',
  version: 1,
  scope: 'session',
  initial: () => ({}),
})

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
    {
      models,
      registry,
      onReport: error =>
        logger.error('durable.background_failed', {
          category: errorCategory(error),
        }),
    },
    BACKGROUND_CONTEXT
  )
  // Migrate saved model references before enabling any recovered generations.
  if (
    !(await harness.snapshot(AzureProviderMigration, BACKGROUND_CONTEXT))?.done
  ) {
    let page = await harness.commit(
      tx => tx.scanConversations({}, 100),
      BACKGROUND_CONTEXT
    )
    for (;;) {
      for (const conversation of page.items) {
        const agent = await harness.snapshot(
          AgentDoc,
          conversation.id,
          BACKGROUND_CONTEXT
        )
        const model = agent?.model
        if (model?.provider === 'azure-openai-responses') {
          await harness.commit(
            tx =>
              configure(tx, conversation.id, {
                model: { ...model, provider: 'azure' },
              }),
            BACKGROUND_CONTEXT
          )
        }
      }
      if (!page.next) break
      const cursor = page.next
      page = await harness.commit(
        tx => tx.scanConversations({}, 100, cursor),
        BACKGROUND_CONTEXT
      )
    }
    await harness.commit(async tx => {
      const migration = await tx.doc(AzureProviderMigration)
      migration.done = true
    }, BACKGROUND_CONTEXT)
  }
  logger.info('durable.ready', {
    backend: durableStorageConfig.url ? 'libsql' : 'node_sqlite',
  })

  // Recover saved work on boot, even when no browser submits a new message.
  harness.resume()
  return harness
}
