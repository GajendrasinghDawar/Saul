import { createFileRoute, Link } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'
import type { AttentionResponse } from '../../../server/services/attention'
import { fetchWithCsrf } from '../lib/api'

export const Route = createFileRoute('/inbox')({ component: InboxPage })

const sections = {
  approvals: 'Pending approvals',
  reminders: 'Due reminders',
  failures: 'Failed tasks',
  results: 'Completed results',
} as const

function InboxPage() {
  const [data, setData] = useState<AttentionResponse | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [message, setMessage] = useState('')
  const [revision, setRevision] = useState(0)
  const mounted = useRef(false)
  const decision = useRef<AbortController | null>(null)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      decision.current?.abort()
    }
  }, [])

  // Fetch only on this authenticated page, on mount or an explicit refresh.
  // No signed-out polling, timers, or background work survive navigation.
  // biome-ignore lint/correctness/useExhaustiveDependencies: revision explicitly requests a fresh inbox read
  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError('')
    void (async () => {
      try {
        const response = await fetch('/api/tasks/attention', {
          cache: 'no-store',
          signal: controller.signal,
        })
        if (!response.ok)
          throw new Error(
            response.status === 401
              ? 'Your session expired. Sign in again.'
              : 'Could not load the attention inbox. Try refreshing.'
          )
        const inbox: AttentionResponse = await response.json()
        if (!controller.signal.aborted) setData(inbox)
      } catch (error) {
        if (!controller.signal.aborted) {
          setData(null)
          setMessage('')
          setError(
            error instanceof Error
              ? error.message
              : 'Could not load the attention inbox.'
          )
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    })()
    return () => controller.abort()
  }, [revision])

  async function decide(id: string, action: 'approve' | 'reject') {
    if (decision.current) return
    const controller = new AbortController()
    decision.current = controller
    setBusy(id)
    setMessage('')
    try {
      const response = await fetchWithCsrf(
        `/api/tasks/approvals/${encodeURIComponent(id)}/${action}`,
        { method: 'POST', signal: controller.signal }
      )
      if (!mounted.current) return
      if (response.status === 409) {
        setMessage(
          'This approval was already decided. The inbox has been refreshed.'
        )
      } else if (!response.ok) {
        throw new Error('Could not save the decision. Refresh and try again.')
      } else {
        setMessage(
          action === 'approve'
            ? 'Approved. The waiting agent continues automatically in the source chat.'
            : 'Rejected. The waiting agent continues without performing the action.'
        )
      }
      setRevision(value => value + 1)
    } catch (error) {
      if (mounted.current && !controller.signal.aborted)
        setMessage(
          error instanceof Error
            ? error.message
            : 'Could not save the decision.'
        )
    } finally {
      decision.current = null
      if (mounted.current) setBusy(null)
    }
  }

  const empty =
    data && Object.values(data.groups).every(items => items.length === 0)
  return (
    <main className='h-full overflow-y-auto bg-slate2 px-4 py-6 md:px-8'>
      <div className='mx-auto max-w-4xl space-y-6'>
        <header className='flex items-center justify-between gap-4 border-b border-slate5 pb-4'>
          <div>
            <h1 className='text-2xl font-bold text-slate12'>Attention inbox</h1>
            <p className='text-sm text-slate10'>
              Requests, reminders and delegated results that need a look.
            </p>
          </div>
          <button
            type='button'
            disabled={loading}
            onClick={() => setRevision(value => value + 1)}
            className='rounded-lg border border-slate6 px-3 py-2 text-sm text-slate12 disabled:opacity-50'
          >
            Refresh
          </button>
        </header>
        <p className='text-sm text-slate10'>
          Items remain here until their source changes. Read and dismissal
          tracking are not available yet.
        </p>
        {loading && (
          <p role='status' className='text-slate11'>
            Loading attention inbox...
          </p>
        )}
        {error && (
          <p
            role='alert'
            className='rounded-lg border border-red6 bg-red3 p-3 text-red11'
          >
            {error}
          </p>
        )}
        {message && (
          <p role='status' className='text-slate11'>
            {message}
          </p>
        )}
        {!loading && !error && empty && (
          <p className='rounded-xl border border-dashed border-slate6 p-8 text-slate11'>
            Nothing needs your attention.
          </p>
        )}
        {data &&
          Object.entries(sections).map(([key, label]) => {
            const items = data.groups[key as keyof typeof sections]
            if (!items.length) return null
            return (
              <section key={key} aria-label={label} className='space-y-3'>
                <h2 className='text-lg font-semibold text-slate12'>
                  {label} ({items.length})
                </h2>
                <ul className='space-y-3'>
                  {items.map(item => (
                    <li
                      key={item.id}
                      className='rounded-xl border border-slate5 bg-slate3 p-4'
                    >
                      <h3 className='font-semibold text-slate12'>
                        {item.title}
                      </h3>
                      <p className='mt-1 whitespace-pre-wrap break-words text-sm text-slate11'>
                        {item.text}
                      </p>
                      {item.timestamp && (
                        <p className='mt-2 text-xs text-slate10'>
                          {new Date(item.timestamp).toLocaleString()}
                        </p>
                      )}
                      <div className='mt-3 flex flex-wrap items-center gap-3'>
                        {item.source ? (
                          <Link
                            to='/chat/$sessionId'
                            params={{ sessionId: item.source.conversationId }}
                            search={{ entry: item.source.entryId ?? undefined }}
                            className='text-sm text-jade11 underline'
                          >
                            Open source conversation
                          </Link>
                        ) : (
                          <span className='text-xs text-slate10'>
                            Source unavailable
                          </span>
                        )}
                        {item.approvalId && (
                          <>
                            <button
                              type='button'
                              disabled={
                                busy !== null ||
                                !item.source ||
                                loading ||
                                Boolean(error)
                              }
                              onClick={() =>
                                item.approvalId &&
                                void decide(item.approvalId, 'approve')
                              }
                              className='rounded-lg bg-jade4 px-3 py-1.5 text-sm text-jade11 disabled:opacity-50'
                            >
                              Approve
                            </button>
                            <button
                              type='button'
                              disabled={
                                busy !== null || loading || Boolean(error)
                              }
                              onClick={() =>
                                item.approvalId &&
                                void decide(item.approvalId, 'reject')
                              }
                              className='rounded-lg border border-slate6 px-3 py-1.5 text-sm text-slate11 disabled:opacity-50'
                            >
                              Reject
                            </button>
                            {busy === item.approvalId && (
                              <span
                                role='status'
                                className='text-xs text-slate10'
                              >
                                Saving...
                              </span>
                            )}
                          </>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            )
          })}
      </div>
    </main>
  )
}
