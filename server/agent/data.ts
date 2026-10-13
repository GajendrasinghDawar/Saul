import crypto from 'node:crypto'
import { and, desc, eq, sql } from 'drizzle-orm'
import { db } from '../db/index.ts'
import * as schema from '../db/schema.ts'

export async function getUserIdForConversation(conversationId: string) {
  const records = await db
    .select()
    .from(schema.userConversations)
    .where(eq(schema.userConversations.conversationId, conversationId))
  if (records.length === 0) throw new Error('Conversation has no owner!')
  return records[0].userId
}

export async function isConversationOwner(
  conversationId: string,
  userId: string
) {
  const records = await db
    .select()
    .from(schema.userConversations)
    .where(
      and(
        eq(schema.userConversations.conversationId, conversationId),
        eq(schema.userConversations.userId, userId)
      )
    )
  return records.length > 0
}

export async function getUserConversationIds(
  userId: string
): Promise<string[]> {
  const records = await db
    .select({ conversationId: schema.userConversations.conversationId })
    .from(schema.userConversations)
    .where(eq(schema.userConversations.userId, userId))
  return records.map(r => r.conversationId)
}

export async function getUserConversations(
  userId: string
): Promise<{ conversationId: string; title: string | null }[]> {
  const records = await db
    .select({
      conversationId: schema.userConversations.conversationId,
      title: schema.userConversations.title,
    })
    .from(schema.userConversations)
    .where(eq(schema.userConversations.userId, userId))
  return records
}

export async function renameConversation(
  conversationId: string,
  userId: string,
  title: string
) {
  const isOwner = await isConversationOwner(conversationId, userId)
  if (!isOwner) throw new Error('Not authorized')

  await db
    .update(schema.userConversations)
    .set({ title })
    .where(eq(schema.userConversations.conversationId, conversationId))
}

export async function deleteUserConversation(
  conversationId: string,
  userId: string
) {
  const isOwner = await isConversationOwner(conversationId, userId)
  if (!isOwner) throw new Error('Not authorized')

  await db
    .delete(schema.userConversations)
    .where(
      and(
        eq(schema.userConversations.conversationId, conversationId),
        eq(schema.userConversations.userId, userId)
      )
    )
}

export async function setRun(runId: string, status: string) {
  // Check if run exists first
  const existing = await db
    .select()
    .from(schema.runs)
    .where(eq(schema.runs.id, runId))
  if (existing.length === 0) {
    await db.insert(schema.runs).values({ id: runId, status })
  } else {
    await db
      .update(schema.runs)
      .set({ status })
      .where(eq(schema.runs.id, runId))
  }
}

export async function logAgentActivity(
  runId: string,
  type: string,
  message: string
) {
  await db.insert(schema.agentEvents).values({
    id: crypto.randomUUID(),
    runId,
    type,
    message,
  })
}

// In the course, agentState gathers the full context (world state + recent events)
export async function agentState(
  userId: string,
  runId: string,
  incomingMessage?: string
) {
  // Gather recent events to give the LLM context of what it just did
  const recentEvents = await db
    .select()
    .from(schema.agentEvents)
    .where(eq(schema.agentEvents.runId, runId))
    .orderBy(desc(schema.agentEvents.createdAt))
    .limit(5)

  // Gather world state (for Lali, the world state is the pending todos)
  const pendingTodos = await db
    .select()
    .from(schema.todos)
    .where(
      sql`${schema.todos.status} = 'pending' AND ${schema.todos.userId} = ${userId}`
    )

  return {
    incomingMessage,
    recentEvents: recentEvents.reverse(), // chronologically
    world: {
      pendingTodos,
    },
  }
}

export async function recordDecision(
  runId: string,
  action: string,
  reason: string
) {
  await logAgentActivity(runId, 'decision', `Decision: ${action} - ${reason}`)
}

export async function recordToolAction(
  runId: string,
  tool: string,
  detail: string
) {
  await logAgentActivity(runId, 'tool', `Tool Executed: ${tool} -> ${detail}`)
}

export async function proposeAction(
  userId: string,
  runId: string,
  action: string,
  detail: string
) {
  const proposalId = crypto.randomUUID()
  await db.insert(schema.approvals).values({
    id: proposalId,
    userId,
    action,
    detail,
    status: 'pending',
  })

  await logAgentActivity(runId, 'human', `Waiting for approval on: ${action}`)
  return proposalId
}

// Helper for tools to modify the world state directly
export async function saveTodo(id: string, userId: string, title: string) {
  await db
    .insert(schema.todos)
    .values({
      id,
      userId,
      title,
      status: 'pending',
    })
    .onConflictDoNothing()
}

export async function requestTodoClear(userId: string, conversationId: string) {
  const action = `clear_todos:${conversationId}`
  return db.transaction(async tx => {
    const existing = await tx
      .select()
      .from(schema.approvals)
      .where(
        sql`${schema.approvals.userId} = ${userId} AND ${schema.approvals.action} = ${action} AND ${schema.approvals.status} IN ('pending', 'approved')`
      )
      .limit(1)
    if (existing[0]) return existing[0]
    const [proposal] = await tx
      .insert(schema.approvals)
      .values({
        id: crypto.randomUUID(),
        userId,
        action,
        detail:
          'Clear all pending todos. New pending todos are included at execution time.',
        status: 'pending',
      })
      .returning()
    return proposal
  })
}

export async function clearTodos(
  userId: string,
  conversationId: string,
  proposalId: string
) {
  // Consume permission and apply the database effect together. A crash cannot
  // leave reusable permission or complete a later batch on tool replay.
  await db.transaction(async tx => {
    const [proposal] = await tx
      .select()
      .from(schema.approvals)
      .where(
        sql`${schema.approvals.id} = ${proposalId} AND ${schema.approvals.userId} = ${userId} AND ${schema.approvals.action} = ${`clear_todos:${conversationId}`}`
      )
    if (proposal?.status === 'consumed') return
    if (proposal?.status !== 'approved')
      throw new Error('A new approval is required.')
    const consumed = await tx
      .update(schema.approvals)
      .set({ status: 'consumed' })
      .where(
        sql`${schema.approvals.id} = ${proposalId} AND ${schema.approvals.status} = 'approved'`
      )
      .returning()
    if (consumed.length === 0) throw new Error('A new approval is required.')
    await tx
      .update(schema.todos)
      .set({ status: 'completed' })
      .where(
        sql`${schema.todos.status} = 'pending' AND ${schema.todos.userId} = ${userId}`
      )
  })
}
