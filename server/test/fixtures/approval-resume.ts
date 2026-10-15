import assert from 'node:assert/strict'
import { once } from 'node:events'
import test from 'node:test'
import { setTimeout } from 'node:timers/promises'
import { BACKGROUND_CONTEXT as ctx } from '@earendil-works/chord/context'
import {
  createModels,
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from '@earendil-works/pi-ai'
import { eq } from 'drizzle-orm'
import express from 'express'
import { saveTodo } from '../../agent/data.ts'
import type { AppDependencies } from '../../app.ts'
import { db, migrateAppDatabase } from '../../db/index.ts'
import { approvals, todos } from '../../db/schema.ts'
import { createChatRouter } from '../../routes/chat.ts'
import { createTasksRouter } from '../../routes/tasks.ts'
import { AttachmentStore } from '../../services/attachments.ts'
import { ChatService } from '../../services/chat.ts'
import { TaskService } from '../../services/tasks.ts'
import { setupDurableHarness } from '../../setup/durable.ts'

test('approval continues without a chat subscriber', {
  timeout: 15_000,
}, async () => {
  await migrateAppDatabase()
  const faux = fauxProvider({ tokensPerSecond: 100_000 })
  const models = createModels()
  models.setProvider(faux.provider)
  let harness = await setupDurableHarness(models, new AttachmentStore())
  const service = new ChatService(harness, () => ({
    provider: 'faux',
    modelId: 'faux-1',
  }))
  const conversationId = await service.createConversation('alice')
  await saveTodo('one', 'alice', 'Send the application')
  faux.setResponses([
    fauxAssistantMessage(fauxToolCall('clear_todos', {}), {
      stopReason: 'toolUse',
    }),
    fauxAssistantMessage('Your approved todos are cleared.'),
  ])
  const app = express()
  app.use((_req, res, next) => {
    res.locals.userId = 'alice'
    next()
  })
  app.use('/api/tasks', createTasksRouter({ harness } as AppDependencies))
  app.use(
    '/api',
    createChatRouter(
      {
        harness,
        models,
        attachments: new AttachmentStore(),
        ai: {
          newConversationModel: async () => ({
            provider: 'faux',
            modelId: 'faux-1',
          }),
        },
      } as unknown as AppDependencies,
      (_req, _res, next) => next(),
      (_req, _res, next) => next()
    )
  )
  const server = app.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  assert.ok(address && typeof address !== 'string')
  const base = `http://127.0.0.1:${address.port}`
  const turn = service.submitMessage(
    conversationId,
    'Clear my todos',
    'reject',
    [],
    'approval-turn'
  )
  // Observe rejection during cleanup too; a closed harness cancels unfinished waits.
  void turn.catch(() => {})
  try {
    let proposal: typeof approvals.$inferSelect | undefined
    for (let i = 0; i < 100; i++) {
      ;[proposal] = await db.select().from(approvals)
      if (proposal) break
      await setTimeout(10)
    }
    assert.ok(proposal, 'tool must create an approval request')
    assert.equal(proposal.status, 'pending')
    const before = await db.select().from(todos).where(eq(todos.id, 'one'))
    assert.equal(before[0].status, 'pending')
    const response = await fetch(
      `${base}/api/tasks/approvals/${proposal.id}/approve`,
      { method: 'POST' }
    )
    assert.equal(response.status, 200)
    let completed = false
    for (let i = 0; i < 100; i++) {
      const [todo] = await db.select().from(todos).where(eq(todos.id, 'one'))
      if (todo.status === 'completed') {
        completed = true
        break
      }
      await setTimeout(10)
    }
    assert.equal(
      completed,
      true,
      'Attention approval must resume the tool without opening its chat or sending another message'
    )
    await turn
    const conversation = await harness.conversation(conversationId, ctx)
    assert.ok(conversation)
    const entries = await conversation.entries({}, 100, undefined, ctx)
    assert.equal(
      entries.items.filter(entry => entry.kind === 'pi.user').length,
      1
    )
    assert.ok(
      JSON.stringify(entries.items).includes('Success: Cleared all todos.')
    )
    assert.equal(
      entries.items.filter(entry => entry.kind === 'lali.approval').length,
      2
    )
    assert.equal(
      (
        await db.select().from(approvals).where(eq(approvals.id, proposal.id))
      )[0].status,
      'consumed'
    )

    // Two chats wait independently. Deciding the original must not wake the other.
    const otherId = await service.createConversation('alice')
    const other = await harness.conversation(otherId, ctx)
    assert.ok(other)
    const begin = (id: typeof conversationId, request: string) => {
      faux.appendResponses([
        fauxAssistantMessage(fauxToolCall('clear_todos', {}), {
          stopReason: 'toolUse',
        }),
      ])
      const pending = service.submitMessage(
        id,
        'Clear the pending todos',
        'reject',
        [],
        request
      )
      void pending.catch(() => {})
      return pending
    }
    const proposalFor = async (id: typeof conversationId) => {
      for (let i = 0; i < 100; i++) {
        const all = await db
          .select()
          .from(approvals)
          .where(eq(approvals.status, 'pending'))
        const pending = all.find(row => row.action === `clear_todos:${id}`)
        if (pending) return pending
        await setTimeout(10)
      }
      throw new Error('No pending approval')
    }
    await saveTodo('later', 'alice', 'Review the next application')
    const otherTurn = begin(otherId, 'other-wait')
    const otherProposal = await proposalFor(otherId)
    const currentTurn = begin(conversationId, 'current-wait')
    const currentProposal = await proposalFor(conversationId)
    const callsBefore = faux.state.callCount
    faux.appendResponses([
      fauxAssistantMessage('Original chat resumed after approval.'),
    ])
    assert.equal(
      (
        await fetch(
          `${base}/api/tasks/approvals/${currentProposal.id}/approve`,
          { method: 'POST' }
        )
      ).status,
      200
    )
    await currentTurn
    assert.equal(faux.state.callCount, callsBefore + 1)
    assert.equal(
      (
        await db
          .select()
          .from(approvals)
          .where(eq(approvals.id, otherProposal.id))
      )[0].status,
      'pending'
    )
    assert.ok(
      !JSON.stringify(
        (await other.entries({}, 100, undefined, ctx)).items
      ).includes('Original chat resumed')
    )
    assert.equal(
      (
        await fetch(
          `${base}/api/tasks/approvals/${currentProposal.id}/reject`,
          { method: 'POST' }
        )
      ).status,
      409
    )

    // A single already-open SSE connection must receive the rejection and continuation.
    await saveTodo('keep', 'alice', 'Keep this after rejection')
    const streamAbort = new AbortController()
    const stream = await fetch(`${base}/api/stream?conversationId=${otherId}`, {
      signal: streamAbort.signal,
    })
    assert.equal(stream.status, 200)
    assert.ok(stream.body)
    const body = stream.body
    const streamed = (async () => {
      let text = ''
      for await (const chunk of body) {
        text += new TextDecoder().decode(chunk)
        if (text.includes('Rejected request: your todos remain unchanged.'))
          return text
      }
      return text
    })()
    faux.appendResponses([
      fauxAssistantMessage('Rejected request: your todos remain unchanged.'),
    ])
    assert.equal(
      (
        await fetch(`${base}/api/tasks/approvals/${otherProposal.id}/reject`, {
          method: 'POST',
        })
      ).status,
      200
    )
    await otherTurn
    const transcript = await streamed
    streamAbort.abort()
    assert.ok(transcript.includes('"type":"update"'))
    assert.ok(transcript.includes('"status":"rejected"'))
    assert.equal(
      (await db.select().from(todos).where(eq(todos.id, 'keep')))[0].status,
      'pending'
    )

    // Persist while paused, decide while stopped, then boot. No submit/wait/view
    // operation is allowed to enable scheduling for this recovery assertion.
    const rebootTurn = begin(conversationId, 'reboot-wait')
    const rebootProposal = await proposalFor(conversationId)
    await setTimeout(50)
    await harness.close(ctx)
    await rebootTurn.catch(() => {})
    await db
      .update(approvals)
      .set({ status: 'approved' })
      .where(eq(approvals.id, rebootProposal.id))
    faux.appendResponses([
      fauxAssistantMessage('Resumed automatically after restart.'),
    ])
    harness = await setupDurableHarness(models, new AttachmentStore())
    let recovered = false
    for (let i = 0; i < 150; i++) {
      const [row] = await db.select().from(todos).where(eq(todos.id, 'keep'))
      if (row.status === 'completed') {
        recovered = true
        break
      }
      await setTimeout(10)
    }
    assert.equal(
      recovered,
      true,
      'startup must resume approved work without a browser or new submission'
    )
    await harness.waitForIdle(ctx)
    const restored = await harness.conversation(conversationId, ctx)
    assert.ok(restored)
    const history = await restored.entries({}, 100, undefined, ctx)
    assert.ok(
      JSON.stringify(history.items).includes(
        'Resumed automatically after restart.'
      )
    )
    assert.equal(
      history.items.filter(
        entry =>
          entry.kind === 'lali.approval' &&
          entry.data &&
          typeof entry.data === 'object' &&
          !Array.isArray(entry.data) &&
          entry.data.id === rebootProposal.id
      ).length,
      2
    )

    // Cancelling a wait must remove its request from Attention, not leave a
    // permission button that can no longer wake any tool.
    const recoveredService = new ChatService(harness, () => ({
      provider: 'faux',
      modelId: 'faux-1',
    }))
    await saveTodo('cancelled', 'alice', 'Keep this after cancellation')
    faux.appendResponses([
      fauxAssistantMessage(fauxToolCall('clear_todos', {}), {
        stopReason: 'toolUse',
      }),
      fauxAssistantMessage('The approval wait was cancelled.'),
    ])
    const cancelledTurn = recoveredService.submitMessage(
      conversationId,
      'Clear my todos',
      'reject',
      [],
      'cancel-wait'
    )
    void cancelledTurn.catch(() => {})
    const cancelledProposal = await proposalFor(conversationId)
    const tasks = new TaskService(harness)
    const wait = (await tasks.getUserTasks('alice')).find(
      task => task.kind === 'lali.approval' && task.state.status !== 'terminal'
    )
    assert.ok(wait)
    assert.equal(await tasks.abortTask(String(wait.id), 'alice'), 'success')
    await cancelledTurn
    assert.equal(
      (await tasks.getApproval(cancelledProposal.id, 'alice'))?.status,
      'interrupted'
    )
    assert.equal((await tasks.getAttention('alice')).groups.approvals.length, 0)
    assert.equal(
      await tasks.setApprovalStatus(cancelledProposal.id, 'alice', 'approved'),
      'conflict'
    )
    assert.equal(
      (await db.select().from(todos).where(eq(todos.id, 'cancelled')))[0]
        .status,
      'pending'
    )
  } finally {
    server.closeAllConnections()
    await new Promise<void>(resolve => server.close(() => resolve()))
    await harness.close(ctx)
  }
})
