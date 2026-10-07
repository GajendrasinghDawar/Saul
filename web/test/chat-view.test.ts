import assert from 'node:assert/strict'
import test from 'node:test'
import {
  type ChatView,
  projectChatView,
} from '../src/features/chat/chat-view.ts'

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
