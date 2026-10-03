import { sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

export const todos = sqliteTable('todos', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  title: text('title').notNull(),
  status: text('status').notNull().default('pending'), // 'pending' | 'completed'
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const userConversations = sqliteTable('user_conversations', {
  conversationId: text('conversation_id').primaryKey(),
  userId: text('user_id').notNull(),
});

export const approvals = sqliteTable('approvals', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  action: text('action').notNull(),
  detail: text('detail'),
  status: text('status').notNull().default('pending'), // 'pending', 'approved', 'rejected'
});

export const runs = sqliteTable('runs', {
  id: text('id').primaryKey(),
  status: text('status').notNull().default('running'),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const agentEvents = sqliteTable('agent_events', {
  id: text('id').primaryKey(),
  runId: text('run_id').notNull(),
  type: text('type').notNull(),
  message: text('message').notNull(),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`).notNull(),
});
