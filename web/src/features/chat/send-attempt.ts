// Only the latest unconfirmed payload can be retried. There is no queued send.
export class SendAttempt {
  private current: { payload: string; requestId: string } | null = null

  requestId(message: string, attachmentIds: string[], whenBusy?: string) {
    const payload = JSON.stringify({ message, attachmentIds, whenBusy })
    if (this.current?.payload !== payload) {
      this.current = { payload, requestId: crypto.randomUUID() }
    }
    return this.current.requestId
  }

  confirmed(requestId: string) {
    if (this.current?.requestId === requestId) this.current = null
  }
}
