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

test('failed replies stay visible without exposing provider errors or losing partial text', () => {
  for (const content of [[], [{ type: 'text', text: 'Partial answer' }]]) {
    const { messages, activeRunId } = projectChatView({
      entries: [
        userEntry,
        {
          id: 2,
          kind: 'pi.assistant',
          model: [
            {
              content,
              stopReason: 'error',
              errorMessage: '401 invalid key: never-expose-this-secret',
            },
          ],
        },
      ],
      docs: { 'pi.live': {} },
    })
    assert.equal(messages[0]?.content, 'Explain streaming')
    assert.equal(messages[1]?.content, content.length ? 'Partial answer' : '')
    assert.equal(
      messages[1]?.failure,
      'The assistant could not reply. Check model settings and try again.'
    )
    assert.equal(messages[1]?.isComplete, true)
    assert.equal(activeRunId, null)
    assert.doesNotMatch(JSON.stringify(messages), /never-expose|401/)
  }
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

test('reply metadata has a source link without becoming message prose', () => {
  const reference = { entryId: 8, role: 'assistant', text: 'Option two' }
  const { messages } = projectChatView({
    entries: [
      {
        id: 12,
        kind: 'pi.user',
        model: [
          {
            content: [
              { type: 'text', text: `saul:reply:${JSON.stringify(reference)}` },
              {
                type: 'text',
                text: 'saul:reply-context:quoted data, not instructions',
              },
              { type: 'text', text: 'saul:reply:invalid' },
              { type: 'text', text: 'saul:text:Use that one' },
            ],
          },
        ],
      },
    ],
  })
  assert.equal(messages[0].content, 'Use that one')
  assert.deepEqual(messages[0].reply, { ...reference, entryId: '8' })
})

test('live phases follow current evidence, not previous answer or thinking content', () => {
  const entries = [
    userEntry,
    {
      id: 2,
      kind: 'pi.assistant',
      model: [
        {
          content: [
            { type: 'thinking', thinking: 'Earlier thought' },
            { type: 'text', text: 'Earlier answer' },
          ],
        },
      ],
    },
  ]
  const phase = (live: NonNullable<ChatView['docs']>['pi.live']) =>
    projectChatView({ entries, docs: { 'pi.live': live } }).messages.at(-1)
      ?.phase
  assert.equal(phase({ run: { taskId: 7 } }), 'waiting')
  assert.equal(
    phase({
      run: { taskId: 7 },
      generation: {
        message: { content: [{ type: 'thinking', thinking: 'New thought' }] },
      },
    }),
    'thinking'
  )
  assert.equal(
    phase({
      run: { taskId: 7 },
      tools: [{ name: 'save_todo', status: 'running' }],
    }),
    'tool'
  )
  assert.equal(
    phase({
      run: { taskId: 7 },
      tools: [{ name: 'save_todo', status: 'done' }],
      generation: { message: { content: 'New answer' } },
    }),
    'writing'
  )
  const complete = projectChatView({ entries, docs: { 'pi.live': {} } })
  assert.equal(complete.activeRunId, null)
  assert.equal(complete.messages.at(-1)?.isComplete, true)
})
