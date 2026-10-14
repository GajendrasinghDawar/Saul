import assert from 'node:assert/strict'
import test from 'node:test'
import {
  ChatOutbox,
  type OutboxEnvironment,
  type OutboxItem,
} from '../src/features/chat/outbox.ts'

function fixture() {
  const values = new Map<string, string>()
  const locks = new Map<string, Promise<unknown>>()
  let online = false
  let now = 1000
  let writes = 0
  const sent: OutboxItem[] = []
  let send: OutboxEnvironment['send'] = async item => {
    sent.push(item)
    return Response.json({ result: { entry: 73 } })
  }
  const environment: OutboxEnvironment = {
    storage: {
      getItem: key => values.get(key) ?? null,
      setItem: (key, value) => {
        writes++
        values.set(key, value)
      },
    },
    lock: async (name, action) => {
      const previous = locks.get(name) ?? Promise.resolve()
      const next = previous.catch(() => {}).then(action)
      locks.set(name, next)
      return next
    },
    online: () => online,
    now: () => now,
    send: item => send(item),
  }
  return {
    environment,
    sent,
    connect: () => {
      online = true
    },
    advance: () => {
      now += 60000
    },
    send: (implementation: typeof send) => {
      send = implementation
    },
    writes: () => writes,
  }
}
const settle = () => new Promise<void>(resolve => setImmediate(resolve))

test('offline restart and a lost response retry the immutable submission, not a second admission', async () => {
  const f = fixture()
  const accepted = new Map<string, number>()
  const seen: OutboxItem[] = []
  f.send(async item => {
    seen.push(item)
    accepted.set(item.requestId, 91)
    if (seen.length === 1) throw new Error('Response lost after admission')
    return Response.json({ result: { entry: accepted.get(item.requestId) } })
  })
  const first = new ChatOutbox('alice', f.environment)
  assert.equal(await first.enqueue('main', 'Do not misroute'), false)
  await first.rememberMain('12')
  assert.equal(
    await first.enqueue(
      'main',
      '  Save this  ',
      [{ id: 'file-a', name: 'cv.txt', mimeType: 'text/plain', size: 17 }],
      'steer',
      '9'
    ),
    true
  )
  const queued = first.snapshot().items[0]
  assert.equal(queued.whenBusy, 'followUp')
  assert.equal(queued.conversationId, '12')
  assert.equal(queued.message, 'Save this')
  first.start()
  await settle()
  assert.equal(seen.length, 0)
  first.stop()
  f.connect()
  const restarted = new ChatOutbox('alice', f.environment)
  restarted.start()
  await settle()
  assert.equal(restarted.snapshot().items[0].status, 'unknown')
  restarted.stop()
  f.advance()
  const again = new ChatOutbox('alice', f.environment)
  again.start()
  await settle()
  assert.equal(accepted.size, 1)
  assert.equal(seen.length, 2)
  assert.equal(seen[0].requestId, queued.requestId)
  assert.equal(seen[1].requestId, queued.requestId)
  assert.deepEqual(seen[1].attachments, queued.attachments)
  assert.equal(seen[1].replyToEntryId, '9')
  assert.equal(again.snapshot().items[0].admittedEntryId, '91')
  await again.acknowledge(['91'])
  assert.equal(again.snapshot().items.length, 0)
  const writes = f.writes()
  await again.tick()
  await again.tick()
  assert.equal(
    f.writes(),
    writes,
    'idle checks must not create cross-tab storage feedback'
  )
  again.stop()
})

test('cross-tab dispatch does not block enqueue or lose new writes while awaiting a response', async () => {
  const f = fixture()
  let release: (value: Response) => void = () => {
    throw new Error('No request')
  }
  const calls: string[] = []
  f.send(item => {
    calls.push(item.message)
    return new Promise(resolve => {
      release = resolve
    })
  })
  const a = new ChatOutbox('alice', f.environment)
  const b = new ChatOutbox('alice', f.environment)
  await a.enqueue('4', 'First')
  f.connect()
  a.start()
  await settle()
  b.start()
  await b.enqueue('4', 'Second')
  assert.equal(b.snapshot().items.length, 2)
  assert.equal(
    await b.remove(a.snapshot().items[0].requestId),
    false,
    'in-flight requests cannot be called cancelled'
  )
  release(Response.json({ result: { entry: 81 } }))
  await settle()
  assert.deepEqual(calls, ['First', 'Second'])
  release(Response.json({ result: { entry: 82 } }))
  await settle()
  a.refresh()
  assert.deepEqual(
    a.snapshot().items.map(item => item.admittedEntryId),
    ['81', '82']
  )
  a.stop()
  b.stop()
})

test('permanent errors block that conversation, not another chat; users have separate queues', async () => {
  const f = fixture()
  f.send(async item => {
    f.sent.push(item)
    return item.conversationId === '4'
      ? new Response('', { status: 400 })
      : Response.json({ result: { entry: 82 } })
  })
  const a = new ChatOutbox('alice', f.environment)
  await a.enqueue('4', 'Invalid')
  await a.enqueue('4', 'Must wait')
  await a.enqueue('5', 'Other chat')
  const b = new ChatOutbox('bob', f.environment)
  assert.deepEqual(b.snapshot().items, [])
  f.connect()
  a.start()
  await settle()
  await a.tick()
  await a.tick()
  assert.deepEqual(
    f.sent.map(item => item.message),
    ['Invalid', 'Other chat']
  )
  assert.equal(a.snapshot().items[0].status, 'failed')
  assert.equal(a.snapshot().items[1].attempts, 0)
  a.stop()
})

test('authentication failures pause sends and a stopped provider starts no more requests', async () => {
  const f = fixture()
  f.send(async item => {
    f.sent.push(item)
    return new Response('', { status: 401 })
  })
  const box = new ChatOutbox('alice', f.environment)
  await box.enqueue('4', 'First')
  await box.enqueue('5', 'Second')
  f.connect()
  box.start()
  await settle()
  await box.tick()
  assert.equal(box.snapshot().paused, true)
  assert.equal(f.sent.length, 1)
  assert.equal(await box.enqueue('5', 'Third'), false)
  box.stop()
  await box.resume()
  await box.tick()
  assert.equal(f.sent.length, 1)
})

test('storage failure never admits a message which was not saved first', async () => {
  const f = fixture()
  f.environment.storage.setItem = () => {
    throw new Error('Storage full')
  }
  const box = new ChatOutbox('alice', f.environment)
  await assert.rejects(box.enqueue('4', 'Keep my draft'), /Storage full/)
  f.connect()
  box.start()
  await settle()
  assert.equal(f.sent.length, 0)
  box.stop()
})
