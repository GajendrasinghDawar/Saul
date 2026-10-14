import type { Attachment } from '../../lib/api.ts'

export type BusyPolicy = 'followUp' | 'steer' | 'reject'
export type OutboxItem = {
  requestId: string
  conversationId: string
  message: string
  attachments: Attachment[]
  whenBusy: BusyPolicy
  replyToEntryId?: string
  status: 'queued' | 'unknown' | 'failed' | 'delivered'
  attempts: number
  nextAttempt: number
  admittedEntryId?: string
  error?: string
}
type State = { main?: string; paused: boolean; items: OutboxItem[] }
export type OutboxEnvironment = {
  storage: Pick<Storage, 'getItem' | 'setItem'>
  lock: <T>(name: string, action: () => Promise<T>) => Promise<T>
  send: (item: OutboxItem) => Promise<Response>
  online: () => boolean
  now: () => number
}

// Short state writes and network dispatch use separate cross-tab locks.
// Unknown requests retain their exact payload: changing it would defeat deduplication.
export class ChatOutbox {
  private key: string
  private environment: OutboxEnvironment
  private listeners = new Set<() => void>()
  private state: State
  private active = false
  private pumping = false

  constructor(userId: string, environment: OutboxEnvironment) {
    this.key = `saul-outbox-v1-${encodeURIComponent(userId)}`
    this.environment = environment
    this.state = this.read()
  }
  private read(): State {
    const raw = this.environment.storage.getItem(this.key)
    return raw ? (JSON.parse(raw) as State) : { paused: false, items: [] }
  }
  snapshot = () => this.state
  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }
  refresh = () => {
    const next = this.read()
    if (JSON.stringify(next) === JSON.stringify(this.state)) return
    this.state = next
    for (const listener of this.listeners) listener()
  }
  private async mutate<T>(action: (state: State) => T): Promise<T> {
    return this.environment.lock(this.key, async () => {
      const state = this.read()
      const before = JSON.stringify(state)
      const result = action(state)
      const after = JSON.stringify(state)
      if (before !== after) this.environment.storage.setItem(this.key, after)
      this.refresh()
      return result
    })
  }
  start() {
    this.active = true
    void this.tick().catch(() => {})
  }
  stop() {
    this.active = false
  }
  async rememberMain(conversationId: string) {
    await this.mutate(state => {
      state.main = conversationId
    })
  }
  async enqueue(
    sessionId: string,
    text: string,
    attachments: Attachment[] = [],
    whenBusy: BusyPolicy = 'followUp',
    replyToEntryId?: string
  ) {
    const message = text.trim()
    if (!message && !attachments.length) return false
    const files = attachments.map(file => ({ ...file }))
    const accepted = await this.mutate(state => {
      const conversationId = sessionId === 'main' ? state.main : sessionId
      if (!conversationId || state.paused) return false
      const requestId = crypto.randomUUID()
      // Durable outbox messages are follow-ups, never delayed steering commands.
      const policy = whenBusy === 'steer' ? 'followUp' : whenBusy
      state.items.push({
        requestId,
        conversationId,
        message,
        attachments: files,
        whenBusy: policy,
        replyToEntryId,
        status: 'queued',
        attempts: 0,
        nextAttempt: 0,
      })
      return true
    })
    if (accepted) void this.tick().catch(() => {})
    return accepted
  }
  async retry(requestId: string) {
    const result = await this.mutate(state => {
      // Authentication failures require a fresh authenticated provider, not a loop.
      if (state.paused) return false
      const item = state.items.find(item => item.requestId === requestId)
      if (!item || item.status === 'delivered' || item.whenBusy === 'steer')
        return false
      item.status = item.attempts ? 'unknown' : 'queued'
      item.error = undefined
      item.nextAttempt = 0
      return true
    })
    void this.tick().catch(() => {})
    return result
  }
  // This forgets a local record, not a cancellation. Unknown sends may be admitted.
  async remove(requestId: string) {
    return this.mutate(state => {
      const before = state.items.length
      state.items = state.items.filter(
        item => item.requestId !== requestId || item.status === 'unknown'
      )
      return before !== state.items.length
    })
  }
  async tick() {
    if (!this.active || this.pumping || !this.environment.online()) return
    this.pumping = true
    try {
      await this.environment.lock(`${this.key}:dispatch`, async () => {
        if (!this.active || !this.environment.online()) return
        const item = await this.mutate(state => {
          if (state.paused) return undefined
          const seen = new Set<string>()
          const next = state.items.find(candidate => {
            if (candidate.status === 'delivered') return false
            if (seen.has(candidate.conversationId)) return false
            seen.add(candidate.conversationId)
            return (
              candidate.status !== 'failed' &&
              candidate.nextAttempt <= this.environment.now()
            )
          })
          if (!next) return undefined
          next.status = 'unknown'
          next.attempts++
          // A second tab or a reload must not immediately repeat an in-flight send.
          next.nextAttempt = this.environment.now() + 35000
          return structuredClone(next)
        })
        if (!item || !this.active) return
        let pause = false
        try {
          const response = await this.environment.send(structuredClone(item))
          if (!response.ok) {
            item.error = `Request failed (${response.status})`
            if (response.status === 401 || response.status === 403) pause = true
            if (
              response.status >= 400 &&
              response.status < 500 &&
              ![408, 409, 429].includes(response.status)
            )
              item.status = 'failed'
          } else {
            const data = (await response.json()) as {
              result?: { entry?: string | number }
            }
            if (
              typeof data.result?.entry !== 'string' &&
              typeof data.result?.entry !== 'number'
            )
              throw new Error('Submission receipt unavailable')
            item.admittedEntryId = String(data.result.entry)
            item.status = 'delivered'
            item.error = undefined
          }
        } catch (error) {
          item.error =
            error instanceof Error ? error.message : 'Delivery unknown'
        }
        if (item.status === 'unknown' && item.attempts >= 8) {
          item.status = 'failed'
          item.error =
            'Delivery is still uncertain. Retry with the same ID to check safely.'
        }
        item.nextAttempt =
          this.environment.now() +
          Math.min(60000, 1000 * 2 ** Math.min(item.attempts - 1, 6))
        await this.mutate(state => {
          const current = state.items.findIndex(
            candidate => candidate.requestId === item.requestId
          )
          if (current !== -1) state.items[current] = item
          if (pause) state.paused = true
        })
      })
    } finally {
      this.pumping = false
    }
  }

  async acknowledge(entryIds: string[]) {
    await this.mutate(state => {
      state.items = state.items.filter(
        item =>
          !item.admittedEntryId || !entryIds.includes(item.admittedEntryId)
      )
    })
  }

  async resume() {
    await this.mutate(state => {
      state.paused = false
    })
    void this.tick().catch(() => {})
  }
}
