import assert from 'node:assert/strict'
import test from 'node:test'
import { mergeDeliveryMessages } from '../src/features/chat/delivery-messages.ts'
import type { PendingDelivery } from '../src/features/chat/message-delivery.ts'
import type { Message } from '../src/features/chat/use-chat-session.ts'

test('a streamed user entry replaces its pending copy before the assistant status', () => {
  const canonical: Message[] = [
    {
      role: 'user',
      content: 'who was gandhi',
      requestId: '327',
      status: 'delivered',
    },
    {
      role: 'assistant',
      content: '',
      requestId: 'live-91',
      phase: 'waiting',
    },
  ]
  const pending: PendingDelivery[] = [
    {
      id: 'request-91',
      conversationId: '12',
      content: 'who was gandhi',
      attachments: [],
      state: 'sending',
      attempted: true,
    },
  ]

  const messages = mergeDeliveryMessages(canonical, pending)

  assert.deepEqual(
    messages.map(message => ({
      role: message.role,
      content: message.content,
      status: message.status,
      phase: message.phase,
    })),
    [
      {
        role: 'user',
        content: 'who was gandhi',
        status: 'delivered',
        phase: undefined,
      },
      {
        role: 'assistant',
        content: '',
        status: undefined,
        phase: 'waiting',
      },
    ]
  )
})

test('an unattempted send is not hidden by identical streamed text', () => {
  const canonical: Message[] = [
    {
      role: 'user',
      content: 'same text',
      requestId: '327',
      status: 'delivered',
    },
    {
      role: 'assistant',
      content: '',
      requestId: 'live-91',
      phase: 'waiting',
    },
  ]
  const pending: PendingDelivery[] = [
    {
      id: 'request-92',
      conversationId: '12',
      content: 'same text',
      attachments: [],
      state: 'waiting',
      attempted: false,
    },
  ]

  const messages = mergeDeliveryMessages(canonical, pending)

  assert.equal(messages.length, 3)
  assert.equal(messages[2]?.deliveryId, 'request-92')
})
