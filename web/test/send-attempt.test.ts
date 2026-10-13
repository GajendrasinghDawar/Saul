import assert from 'node:assert/strict'
import test from 'node:test'
import { SendAttempt } from '../src/features/chat/send-attempt.ts'

test('manual retries keep the request ID until the payload changes or succeeds', () => {
  const attempt = new SendAttempt()
  const first = attempt.requestId('Hello', ['file'])
  assert.equal(attempt.requestId('Hello', ['file']), first)
  const changedText = attempt.requestId('Changed', ['file'])
  assert.notEqual(changedText, first)
  const changedFile = attempt.requestId('Changed', ['other'])
  assert.notEqual(changedFile, changedText)
  const changedPolicy = attempt.requestId('Changed', ['other'], 'steer')
  assert.notEqual(changedPolicy, changedFile)
  assert.equal(attempt.requestId('Changed', ['other'], 'steer'), changedPolicy)
  attempt.confirmed(first)
  assert.equal(attempt.requestId('Changed', ['other'], 'steer'), changedPolicy)
  attempt.confirmed(changedPolicy)
  assert.notEqual(
    attempt.requestId('Changed', ['other'], 'steer'),
    changedPolicy
  )
})

test('separate conversations do not share retry identities', () => {
  assert.notEqual(
    new SendAttempt().requestId('Hello', []),
    new SendAttempt().requestId('Hello', [])
  )
})
