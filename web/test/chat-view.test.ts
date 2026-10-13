import assert from 'node:assert/strict'
import test from 'node:test'
import {
  type ChatView,
  projectChatView,
  reconcilePendingMessages,
} from '../src/features/chat/chat-view.ts'
import type { Message } from '../src/features/chat/use-chat-session.ts'

const userEntry = {
  id: 1,
  kind: 'pi.user',
  model: [{ content: 'Explain streaming' }],
}

test('projects in-progress text from the live generation', () => {
  const projection = projectChatView({
    entries: [userEntry],
    docs: {
      'pi.live': {
        run: { taskId: 42 },
        generation: {
          message: {
            content: [{ type: 'text', text: 'Partial answer' }],
          },
        },
      },
    },
  } satisfies ChatView)

  assert.equal(projection.messages.at(-1)?.role, 'assistant')
  assert.equal(projection.messages.at(-1)?.content, 'Partial answer')
  assert.equal(projection.activeRunId, projection.messages.at(-1)?.requestId)
})

test('keeps thinking separate from the visible answer while streaming', () => {
  const projection = projectChatView({
    entries: [userEntry],
    docs: {
      'pi.live': {
        run: { taskId: 43 },
        generation: {
          message: {
            content: [
              { type: 'thinking', thinking: 'Checking the details' },
              { type: 'text', text: 'The answer' },
            ],
          },
        },
      },
    },
  } satisfies ChatView)

  const assistant = projection.messages.at(-1)
  assert.equal(assistant?.thinkingContent, 'Checking the details')
  assert.equal(assistant?.content, 'The answer')
})

test('does not duplicate a live response after it becomes an entry', () => {
  const projection = projectChatView({
    entries: [
      userEntry,
      {
        id: 2,
        kind: 'pi.assistant',
        model: [
          {
            content: [{ type: 'text', text: 'Finished answer' }],
            stopReason: 'stop',
          },
        ],
      },
    ],
    docs: { 'pi.live': {} },
  } satisfies ChatView)

  assert.equal(projection.messages.length, 2)
  assert.equal(projection.messages[1]?.content, 'Finished answer')
  assert.equal(projection.messages[1]?.isComplete, true)
  assert.equal(projection.activeRunId, null)
})

const attachment = {
  id: 'file-1',
  name: 'notes.md',
  mimeType: 'text/markdown',
  size: 1024,
}
const marker = `saul:attachment:${JSON.stringify(attachment)}`

test('projects persisted attachment references without exposing markers', () => {
  const { messages } = projectChatView({
    entries: [
      {
        id: 10,
        kind: 'pi.user',
        model: [
          {
            content: [
              { type: 'text', text: 'Read ' },
              { type: 'text', text: marker },
              { type: 'text', text: 'this' },
            ],
          },
        ],
      },
    ],
  })
  assert.equal(messages[0].content, 'Read this')
  assert.deepEqual(messages[0].attachments, [attachment])
})

test('supports attachment-only entries and hides malformed internal markers', () => {
  const { messages } = projectChatView({
    entries: [
      {
        id: 11,
        kind: 'pi.user',
        model: [
          {
            content: [
              { type: 'text', text: marker },
              { type: 'text', text: 'saul:attachment:invalid' },
              { type: 'text', text: 'saul:attachment:{"id":"bad"}' },
            ],
          },
        ],
      },
    ],
  })
  assert.equal(messages[0].content, '')
  assert.deepEqual(messages[0].attachments, [attachment])
  const literal = projectChatView({
    entries: [
      {
        id: 12,
        kind: 'pi.user',
        model: [
          {
            content: [
              { type: 'text', text: `saul:text:${marker}` },
              { type: 'text', text: marker },
            ],
          },
        ],
      },
    ],
  })
  assert.equal(literal.messages[0].content, marker)
  assert.deepEqual(literal.messages[0].attachments, [attachment])
})

test('reconciles only new canonical entries with the same text and attachment IDs', () => {
  const canonical = (id: string, attachments = [attachment]): Message => ({
    role: 'user',
    content: 'Read',
    requestId: id,
    attachments,
  })
  const seen = new Set<string>()
  const pending = new Map<string, Message>()
  reconcilePendingMessages([canonical('old')], pending, seen)
  pending.set('pending', { ...canonical('pending'), status: 'sending' })
  reconcilePendingMessages([canonical('old')], pending, seen)
  assert.equal(pending.size, 1)
  reconcilePendingMessages(
    [canonical('wrong-file', [{ ...attachment, id: 'other' }])],
    pending,
    seen
  )
  assert.equal(pending.size, 1)
  reconcilePendingMessages([canonical('new')], pending, seen)
  assert.equal(pending.size, 0)
})

test('a canonical entry acknowledges at most one pending send and prefers waiting sends', () => {
  const message: Message = {
    role: 'user',
    content: '',
    requestId: 'pending',
    attachments: [attachment],
    status: 'sending',
  }
  const pending = new Map([
    ['failed', { ...message, status: 'failed' as const }],
    ['one', message],
    ['two', message],
  ])
  const seen = new Set<string>()
  reconcilePendingMessages([{ ...message, requestId: 'new' }], pending, seen)
  assert.deepEqual([...pending.keys()], ['failed', 'two'])
  reconcilePendingMessages([{ ...message, requestId: 'new' }], pending, seen)
  assert.equal(pending.size, 2)
  reconcilePendingMessages([{ ...message, requestId: 'newer' }], pending, seen)
  reconcilePendingMessages([{ ...message, requestId: 'last' }], pending, seen)
  assert.equal(pending.size, 0)
})
