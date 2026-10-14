import {
  createContext,
  type ReactNode,
  type SetStateAction,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
} from 'react'
import { fetchWithCsrf } from '../../lib/api'
import { useAuthenticatedUserId } from '../auth/AuthGate'
import type { ComposerReply, StagedFile } from './Composer'
import { ChatOutbox } from './outbox'

// Owned by the authenticated shell, not by a route.
export class ChatDraft {
  private listeners = new Set<() => void>()
  private value: {
    text: string
    files: StagedFile[]
    sending: boolean
    revision: number
    reply: ComposerReply | null
  }
  private storage: Pick<Storage, 'getItem' | 'setItem'>
  private key: string

  constructor(
    sessionId: string,
    storage: Pick<Storage, 'getItem' | 'setItem'>
  ) {
    this.key = `lali-draft-${sessionId}`
    this.storage = storage
    this.value = {
      text: storage.getItem(this.key) ?? '',
      files: [],
      sending: false,
      revision: 0,
      reply: null,
    }
  }

  snapshot = () => this.value
  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }
  private publish() {
    for (const listener of this.listeners) listener()
  }
  setText = (text: string) => {
    this.value = { ...this.value, text, revision: this.value.revision + 1 }
    this.storage.setItem(this.key, text)
    this.publish()
  }
  setFiles = (files: SetStateAction<StagedFile[]>) => {
    this.value = {
      ...this.value,
      files: typeof files === 'function' ? files(this.value.files) : files,
    }
    this.publish()
  }
  setSending = (sending: boolean) => {
    this.value = { ...this.value, sending }
    this.publish()
  }
  setReply = (reply: ComposerReply | null) => {
    this.value = { ...this.value, reply, revision: this.value.revision + 1 }
    this.publish()
  }
  delivered(revision: number, files: StagedFile[]) {
    if (this.value.revision === revision) {
      this.setText('')
      this.setReply(null)
    }
    this.setFiles(current => current.filter(file => !files.includes(file)))
  }
}

const DraftsContext = createContext<Map<string, ChatDraft> | null>(null)
const OutboxContext = createContext<ChatOutbox | null>(null)

export function useChatOutbox() {
  const outbox = useContext(OutboxContext)
  if (!outbox) throw new Error('Chat outbox requires the authenticated shell.')
  const state = useSyncExternalStore(outbox.subscribe, outbox.snapshot)
  return { outbox, ...state }
}

export function ChatDraftProvider({ children }: { children: ReactNode }) {
  const userId = useAuthenticatedUserId()
  // biome-ignore lint/correctness/useExhaustiveDependencies: discard in-memory files and drafts when the authenticated user changes
  const drafts = useMemo(() => new Map<string, ChatDraft>(), [userId])
  const outbox = useMemo(
    () =>
      new ChatOutbox(userId, {
        storage: localStorage,
        lock: (name, action) => navigator.locks.request(name, action),
        online: () => navigator.onLine,
        now: Date.now,
        send: item =>
          fetchWithCsrf('/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            signal: AbortSignal.timeout(30000),
            body: JSON.stringify({
              requestId: item.requestId,
              conversationId: item.conversationId,
              message: item.message,
              attachmentIds: item.attachments.map(file => file.id),
              whenBusy: item.whenBusy,
              replyToEntryId:
                item.replyToEntryId === undefined
                  ? undefined
                  : Number(item.replyToEntryId),
            }),
          }),
      }),
    [userId]
  )
  useEffect(() => {
    outbox.start()
    void outbox.resume()
    const wake = () => {
      outbox.refresh()
      void outbox.tick().catch(console.error)
    }
    window.addEventListener('online', wake)
    window.addEventListener('storage', wake)
    const timer = window.setInterval(wake, 1000)
    return () => {
      outbox.stop()
      clearInterval(timer)
      window.removeEventListener('online', wake)
      window.removeEventListener('storage', wake)
    }
  }, [outbox])
  return (
    <DraftsContext value={drafts}>
      <OutboxContext value={outbox}>{children}</OutboxContext>
    </DraftsContext>
  )
}

export function useChatDraft(sessionId: string) {
  const userId = useAuthenticatedUserId()
  const drafts = useContext(DraftsContext)
  if (!drafts) throw new Error('Chat drafts require the authenticated shell.')
  let draft = drafts.get(sessionId)
  if (!draft) {
    draft = new ChatDraft(JSON.stringify([userId, sessionId]), sessionStorage)
    drafts.set(sessionId, draft)
  }
  const snapshot = useSyncExternalStore(draft.subscribe, draft.snapshot)
  return { draft, ...snapshot }
}
