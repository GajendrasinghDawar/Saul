import { createFileRoute, Link } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'

export const Route = createFileRoute('/search')({ component: SearchPage })

type Hit = {
  conversationId: string
  entryId: number
  role: 'user' | 'assistant'
  text: string
  title: string | null
}
type SearchPageResult = {
  results: Hit[]
  nextCursor: string | null
  truncated: boolean
}

function SearchPage() {
  const [query, setQuery] = useState('')
  const [searched, setSearched] = useState('')
  const [results, setResults] = useState<Hit[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const request = useRef(0)
  useEffect(
    () => () => {
      request.current++
    },
    []
  )

  async function search(next?: string) {
    const q = next ? searched : query.trim()
    if (!q) return
    const current = ++request.current
    setLoading(true)
    setError('')
    if (!next) {
      setResults([])
      setCursor(null)
      setSearched(q)
    }
    try {
      const params = new URLSearchParams({ q })
      if (next) params.set('cursor', next)
      const response = await fetch(`/api/search?${params}`)
      if (!response.ok)
        throw new Error(
          response.status === 401
            ? 'Sign in again to search your history.'
            : 'Could not search history. Please retry.'
        )
      const data: SearchPageResult = await response.json()
      if (current !== request.current) return
      setResults(previous =>
        next ? [...previous, ...data.results] : data.results
      )
      setCursor(data.nextCursor)
    } catch (failure) {
      if (current === request.current)
        setError(
          failure instanceof Error
            ? failure.message
            : 'Could not search history.'
        )
    } finally {
      if (current === request.current) setLoading(false)
    }
  }

  return (
    <main className='mx-auto h-full w-full max-w-3xl space-y-6 overflow-y-auto p-6 text-slate12'>
      <header>
        <h1 className='text-2xl font-semibold'>Search history</h1>
        <p className='mt-2 text-sm text-slate10'>
          Search your saved messages and assistant replies. No agent or paid
          tools are run.
        </p>
      </header>
      <form
        className='flex gap-3'
        onSubmit={event => {
          event.preventDefault()
          void search()
        }}
      >
        <label className='sr-only' htmlFor='history-query'>
          Search messages
        </label>
        <input
          id='history-query'
          maxLength={200}
          value={query}
          onChange={event => setQuery(event.target.value)}
          placeholder='Search messages'
          className='min-w-0 flex-1 rounded-lg border border-slate6 bg-slate3 px-4 py-3 outline-none focus:border-jade8'
        />
        <button
          type='submit'
          disabled={loading || !query.trim()}
          className='rounded-lg bg-jade4 px-4 py-3 font-medium text-jade11 disabled:opacity-50'
        >
          Search
        </button>
      </form>
      {loading && (
        <p role='status' className='text-slate10'>
          Searching saved history…
        </p>
      )}
      {error && (
        <p role='alert' className='text-red11'>
          {error}
        </p>
      )}
      {!loading && !error && searched && results.length === 0 && (
        <p className='text-slate10'>
          No matches{' '}
          {cursor
            ? 'in the history scanned so far. Continue to search older history.'
            : 'in your saved history.'}
        </p>
      )}
      <ul className='space-y-3'>
        {results.map(hit => (
          <li key={`${hit.conversationId}:${hit.entryId}`}>
            <Link
              to='/chat/$sessionId'
              params={{ sessionId: hit.conversationId }}
              search={{ entry: String(hit.entryId) }}
              className='block rounded-xl border border-slate6 bg-slate3 p-4 hover:border-jade8 focus-visible:outline-jade8'
            >
              <div className='flex justify-between gap-3 text-sm'>
                <span className='font-medium text-jade11'>
                  {hit.title || `Chat ${hit.conversationId}`}
                </span>
                <span className='text-slate10'>{hit.role}</span>
              </div>
              <p className='mt-2 whitespace-pre-wrap break-words text-sm text-slate11'>
                {hit.text}
              </p>
            </Link>
          </li>
        ))}
      </ul>
      {cursor && (
        <div className='space-y-2'>
          <p className='text-sm text-slate10'>
            More history remains. Results are not exhaustive yet.
          </p>
          <button
            type='button'
            disabled={loading}
            onClick={() => void search(cursor)}
            className='rounded-lg border border-slate6 px-4 py-2 text-jade11 disabled:opacity-50'
          >
            Search more history
          </button>
        </div>
      )}
    </main>
  )
}
