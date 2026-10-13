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

// All read-modify-write operations and dispatches share the same cross-tab lock.
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
    return raw ? JSON.parse(raw) as State : { paused: false, items: [] }
  }
  snapshot = () => this.state
  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }
  refresh = () => {
    this.state = this.read()
    for (const listener of this.listeners) listener()
  }
  private async mutate<T>(action: (state: State) => T): Promise<T> {
    return this.environment.lock(this.key, async () => {
      const state = this.read()
      const result = action(state)
      this.environment.storage.setItem(this.key, JSON.stringify(state))
      this.refresh()
      return result
    })
  }
  start() { this.active = true; void this.tick() }
  stop() { this.active = false }
  async rememberMain(conversationId: string) {
    await this.mutate(state => { state.main = conversationId })
  }
  async enqueue(sessionId: string, text: string, attachments: Attachment[] = [], whenBusy: BusyPolicy = 'followUp', replyToEntryId?: string) {
    const message = text.trim()
    if (!message && !attachments.length) return false
    // Steering is only meaningful for a live run; durable sends never steer.
    if (whenBusy === 'steer') return false
    const accepted = await this.mutate(state => {
      const conversationId = sessionId === 'main' ? state.main : sessionId
      if (!conversationId || state.paused) return false
      state.items.push({
        requestId: crypto.randomUUID(), conversationId, message,
        attachments: attachments.map(file => ({ ...file })),
        whenBusy: this.environment.online() ? whenBusy : 'followUp',
        replyToEntryId, status: 'queued', attempts: 0, nextAttempt: 0,
      })
      return true
    })
    if (accepted) void this.tick()
    return accepted
  }
  async retry(requestId: string) {
    const result = await this.mutate(state => {
      // Authentication failures require a fresh authenticated provider, not a loop.
      if (state.paused) return false
      const item = state.items.find(item => item.requestId === requestId)
      if (!item || item.status === 'delivered') return false
      item.status = item.attempts ? 'unknown' : 'queued'
      item.error = undefined
      item.nextAttempt = 0
      return true
    })
    void this.tick()
    return result
  }
  // This forgets a local record, not a cancellation. Unknown sends may be admitted.
  async remove(requestId: string) {
    return this.mutate(state => {
      const before = state.items.length
      state.items = state.items.filter(item => item.requestId !== requestId)
      return before !== state.items.length
    })
  }
  async tick() {
    if (!this.active || this.pumping || !this.environment.online()) return
    this.pumping = true
    try {
      await this.environment.lock(this.key, async () => {
        if (!this.active || !this.environment.online()) return
        const state = this.read()
        if (state.paused) return
        const item = state.items.find(item => item.status !== 'delivered')
        // Failed/uncertain head blocks later sends to preserve submission order.
        if (!item || item.status === 'failed' || item.nextAttempt > this.environment.now()) return
        item.status = 'unknown'
        item.attempts++
        this.environment.storage.setItem(this.key, JSON.stringify(state))
        this.refresh()
        try {
          const response = await this.environment.send(structuredClone(item))
          if (!response.ok) {
            item.error = `Request failed (${response.status})`
            if (response.status === 401 || response.status === 403) state.paused = true
            if (response.status >= 400 && response.status < 500 && response.status !== 408 && response.status !== 429) item.status = 'failed'
          } else {
            const data = await response.json() as { result?: { entry?: string | number } }
            if (data.result?.entry === undefined) throw new Error('Submission receipt unavailable')
            item.admittedEntryId = String(data.result.entry)
            item.status = 'delivered'
            item.error = undefined
          }
        } catch (error) {
          item.error = error instanceof Error ? error.message : 'Delivery unknown'
        }
        item.nextAttempt = this.environment.now() + Math.min(60000, 1000 * 2 ** Math.min(item.attempts - 1, 6))
        this.environment.storage.setItem(this.key, JSON.stringify(state))
        this.refresh()
      })
    } finally { this.pumping = false }
  }
}
