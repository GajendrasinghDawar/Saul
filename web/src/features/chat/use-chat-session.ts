import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { fetchWithCsrf } from '../../lib/api'

export type Message = {
  role: 'user' | 'assistant'
  content: string
  requestId: string
  idempotencyKey?: string
  status?: 'sending' | 'delivered' | 'failed'
  activities?: string[]
  effects?: Effect[]
  isComplete?: boolean
}

export type Effect = {
  id: string
  summary?: string
  type?: string
  payload?: unknown
  data?: unknown
  digest?: string
  status?:
    | 'pending'
    | 'approved'
    | 'rejected'
    | 'running'
    | 'executed'
    | 'failed'
    | 'expired'
    | 'interrupted'
    | 'unknown'
}

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected'

export function useChatSession(sessionId: string) {
  const [messages, setMessages] = useState<Message[]>([])
  const [activeRunId, setActiveRunId] = useState<string | null>(null)
  const [isCancelling, setIsCancelling] = useState(false)
  const [connectionStatus, setConnectionStatus] =
    useState<ConnectionStatus>('connecting')

  // Keep a ref to pending messages so we can overlay them on the server state
  const pendingMessagesRef = useRef<Map<string, Message>>(new Map())

  useEffect(() => {
    setConnectionStatus('connecting')
    setMessages([])
    pendingMessagesRef.current.clear()

    // Map pi-durable entries (which are Git-like commit nodes) to our UI Message format
    // biome-ignore lint/suspicious/noExplicitAny: complex structure
    const processView = (view: any) => {
      const msgs: Message[] = []
      let currentAssistantMsg: Message | null = null
      let lastRequestId: string | null = null

      // view.entries contains the conversation thread path from root to leaf
      for (const entry of view.entries || []) {
        if (entry.kind === 'pi.user') {
          let text = ''
          if (typeof entry.model[0]?.content === 'string')
            text = entry.model[0].content
          else if (Array.isArray(entry.model[0]?.content))
            text = entry.model[0].content
              .map((c: { text?: string }) => c.text)
              .join('')

          // Clean up pending optimistic UI messages that have been confirmed by the server
          for (const [key, pm] of pendingMessagesRef.current.entries()) {
            if (pm.content === text) {
              pendingMessagesRef.current.delete(key)
            }
          }

          msgs.push({
            role: 'user',
            content: text,
            requestId: String(entry.id),
            status: 'delivered',
          })
          currentAssistantMsg = null
        } else if (entry.kind === 'pi.assistant') {
          // LLM outputs stream here. pi.assistant merges text and toolCall chunks
          const parts = entry.model[0]?.content
          if (typeof parts === 'string') {
            if (!currentAssistantMsg) {
              currentAssistantMsg = {
                role: 'assistant',
                content: '',
                requestId: String(entry.id),
                activities: [],
                effects: [],
              }
              msgs.push(currentAssistantMsg)
            }
            currentAssistantMsg.content += parts
          } else if (Array.isArray(parts)) {
            for (const part of parts) {
              if (part.type === 'text') {
                if (!currentAssistantMsg) {
                  currentAssistantMsg = {
                    role: 'assistant',
                    content: '',
                    requestId: String(entry.id),
                    activities: [],
                    effects: [],
                  }
                  msgs.push(currentAssistantMsg)
                }
                currentAssistantMsg.content += part.text
              } else if (part.type === 'toolCall') {
                if (!currentAssistantMsg) {
                  currentAssistantMsg = {
                    role: 'assistant',
                    content: '',
                    requestId: String(entry.id),
                    activities: [],
                    effects: [],
                  }
                  msgs.push(currentAssistantMsg)
                }
                currentAssistantMsg.activities?.push(`Using Tool: ${part.name}`)
              }
            }
          }
          lastRequestId = String(entry.id)
        } else if (entry.kind === 'pi.tool-result') {
          if (currentAssistantMsg) {
            const res = entry.model[0]
            let text = ''
            if (Array.isArray(res.content))
              text =
                res.content.find(
                  (c: { type: string; text?: string }) => c.type === 'text'
                )?.text || ''
            else text = res.content

            // We use a convention where the pi-durable backend can return
            // a block response containing [APPROVAL REQUIRED] to trigger a UI interaction.
            if (text.startsWith('[APPROVAL REQUIRED]')) {
              const proposalIdMatch = text.match(/Proposal ID: (.*?)\./)
              if (proposalIdMatch) {
                currentAssistantMsg.effects?.push({
                  id: proposalIdMatch[1],
                  type: 'approval',
                  summary: 'Action requires your approval',
                  status: 'pending',
                })
              }
            } else {
              currentAssistantMsg.activities?.push(
                `Result: ${String(text).substring(0, 50)}...`
              )
            }
          }
        }
      }

      // Check if the last assistant entry is complete (has a stopReason that isn't null).
      // This indicates the Pi Durable run loop has yielded and is no longer busy.
      const lastEntry = view.entries?.[view.entries.length - 1]
      const isBusy =
        (lastEntry?.kind === 'pi.assistant' ||
          lastEntry?.kind === 'pi.tool-result') &&
        !lastEntry?.model?.[0]?.stopReason

      if (
        lastEntry?.kind === 'pi.assistant' &&
        lastEntry.model?.[0]?.stopReason
      ) {
        if (currentAssistantMsg) currentAssistantMsg.isComplete = true
        setActiveRunId(null)
      } else if (
        lastEntry?.kind === 'pi.assistant' ||
        lastEntry?.kind === 'pi.tool-result' ||
        lastEntry?.kind === 'pi.user'
      ) {
        setActiveRunId(lastRequestId)
      }

      // Dispatch event to sync sidebar when the stream transitions from busy to idle
      if (!isBusy && window.sessionStorage.getItem(`busy-${sessionId}`)) {
        window.sessionStorage.removeItem(`busy-${sessionId}`)
        window.dispatchEvent(new CustomEvent('chat-updated'))
      } else if (isBusy) {
        window.sessionStorage.setItem(`busy-${sessionId}`, 'true')
      }

      // Overlay pending messages
      const finalMsgs = [...msgs]
      for (const pm of pendingMessagesRef.current.values()) {
        finalMsgs.push(pm)
      }
      setMessages(finalMsgs)
    }

    // Connect to the Pi Durable SSE stream endpoint
    const es = new EventSource(
      `/api/stream?conversationId=${sessionId === 'main' ? '' : sessionId}`
    )

    es.onopen = () => setConnectionStatus('connected')
    es.onerror = () => setConnectionStatus('disconnected')

    es.onmessage = e => {
      const data = JSON.parse(e.data)
      if (data.type === 'init' || data.type === 'update') {
        processView(data.view)
      }
    }

    return () => {
      es.close()
    }
  }, [sessionId])

  const submitMessage = async (
    text: string,
    attachmentIds: string[] = [],
    whenBusy?: 'queue' | 'steer' | 'reject'
  ) => {
    if (
      (activeRunId && whenBusy !== 'steer') ||
      (!text.trim() && attachmentIds.length === 0)
    )
      return

    const idempotencyKey =
      typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : Date.now().toString(36) + Math.random().toString(36).substring(2)
    const pendingMsg: Message = {
      role: 'user',
      content: text,
      requestId: idempotencyKey,
      idempotencyKey,
      status: 'sending',
    }

    pendingMessagesRef.current.set(idempotencyKey, pendingMsg)
    setMessages(prev => [...prev, pendingMsg])

    try {
      const res = await fetchWithCsrf('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversationId: sessionId === 'main' ? undefined : sessionId,
          message: text,
          attachmentIds,
          whenBusy,
        }),
      })

      if (!res.ok) throw new Error(`Failed to send message: ${res.status}`)

      // We no longer manually delete the pending message here!
      // The SSE stream (processView) will match the content and delete it when the server confirms it,
      // avoiding any UI flicker.
    } catch (e) {
      console.error('Failed to send message', e)

      // Improve UX: show a toast when a message fails to send (like a 404)
      if (e instanceof Error && e.message.includes('404')) {
        toast.error('Conversation not found. It may have been deleted.')
      } else {
        toast.error('Failed to send message. Please try again.')
      }

      const m = pendingMessagesRef.current.get(idempotencyKey)
      if (m) {
        m.status = 'failed'
        setMessages(prev => [...prev]) // Trigger re-render
      }
    }
  }

  const stop = async () => {
    setIsCancelling(true)
    // TODO: implement interrupt in pi-durable if needed
    setTimeout(() => setIsCancelling(false), 2000)
  }

  const forkMessage = async (messageId: string) => {
    try {
      const res = await fetchWithCsrf(`/api/fork/${messageId}`, {
        method: 'POST',
      })
      if (!res.ok) throw new Error('Failed to fork conversation')
      const data = await res.json()
      return data.newConversationId
    } catch (e) {
      console.error('Fork failed', e)
      throw e
    }
  }

  return {
    messages,
    activeRunId,
    isCancelling,
    connectionStatus,
    submitMessage,
    stop,
    forkMessage,
  }
}
