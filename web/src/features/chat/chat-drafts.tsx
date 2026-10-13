import {
  createContext,
  type ReactNode,
  type SetStateAction,
  useContext,
  useState,
  useSyncExternalStore,
} from 'react'
import type { StagedFile } from './Composer'
import { SendAttempt } from './send-attempt'

// Owned by the authenticated shell, not by a route. No offline sending.
export class ChatDraft {
  readonly attempt = new SendAttempt()
  private listeners = new Set<() => void>()
  private value: {
    text: string
    files: StagedFile[]
    sending: boolean
    revision: number
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
  delivered(revision: number, files: StagedFile[]) {
    if (this.value.revision === revision) this.setText('')
    this.setFiles(current => current.filter(file => !files.includes(file)))
  }
}

const DraftsContext = createContext<Map<string, ChatDraft> | null>(null)

export function ChatDraftProvider({ children }: { children: ReactNode }) {
  const [drafts] = useState(() => new Map<string, ChatDraft>())
  return <DraftsContext value={drafts}>{children}</DraftsContext>
}

export function useChatDraft(sessionId: string) {
  const drafts = useContext(DraftsContext)
  if (!drafts) throw new Error('Chat drafts require the authenticated shell.')
  let draft = drafts.get(sessionId)
  if (!draft) {
    draft = new ChatDraft(sessionId, sessionStorage)
    drafts.set(sessionId, draft)
  }
  const snapshot = useSyncExternalStore(draft.subscribe, draft.snapshot)
  return { draft, ...snapshot }
}
