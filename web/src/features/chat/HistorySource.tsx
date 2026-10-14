import { useEffect, useState } from 'react'
import type { ComposerReply } from './Composer'

// Compaction removes older entries from the live view, not from saved history.
export function HistorySource({
  conversationId,
  entryId,
  onReply,
}: {
  conversationId: string
  entryId: string
  onReply: (reply: ComposerReply) => void
}) {
  const [message, setMessage] = useState<ComposerReply | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    const controller = new AbortController()
    setMessage(null)
    setError('')
    void fetch(
      `/api/history/${encodeURIComponent(conversationId)}/${encodeURIComponent(entryId)}`,
      { cache: 'no-store', signal: controller.signal }
    )
      .then(async response => {
        if (!response.ok) throw new Error('This source message is unavailable.')
        const data: {
          message: { entryId: number; role: 'user' | 'assistant'; text: string }
        } = await response.json()
        if (!controller.signal.aborted)
          setMessage({ ...data.message, entryId: String(data.message.entryId) })
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setError(
            'This source message is unavailable. Try opening it again when connected.'
          )
      })
    return () => controller.abort()
  }, [conversationId, entryId])
  return (
    <section
      aria-label='Saved source message'
      className='mx-auto max-h-56 w-full max-w-3xl shrink-0 overflow-y-auto rounded-xl border border-jade7 bg-slate3 p-4 text-sm text-slate11'
    >
      <h2 className='font-medium text-jade11'>
        Earlier message · saved source excerpt
      </h2>
      {error ? (
        <p role='status'>{error}</p>
      ) : !message ? (
        <p role='status'>Loading source…</p>
      ) : (
        <>
          <p className='mt-2 whitespace-pre-wrap break-words'>{message.text}</p>
          <button
            type='button'
            onClick={() => onReply(message)}
            className='mt-2 rounded px-3 py-2 text-jade11'
          >
            Reply to this message
          </button>
        </>
      )}
    </section>
  )
}
