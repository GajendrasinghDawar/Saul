import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { GitBranch, Hash, MessageCircle, Send } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

export const Route = createFileRoute('/chat/thread/$threadId')({
  component: ChatTab,
})

function ChatTab() {
  const { threadId } = Route.useParams()
  const navigate = useNavigate({ from: Route.fullPath })
  const activeThreadId = Number(threadId)

  const [view, setView] = useState<any>(null)
  const [threads, setThreads] = useState<any[]>([])
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)

  // Fetch threads on load
  const fetchThreads = async () => {
    try {
      const res = await fetch('/api/conversations')
      const data = await res.json()
      setThreads(data.conversations || [])
    } catch (_e) {}
  }

  useEffect(() => {
    fetchThreads()
  }, [fetchThreads])

  // Connect to SSE stream for the active thread
  useEffect(() => {
    if (!activeThreadId) return

    const url = `/api/stream?conversationId=${activeThreadId}`
    const sse = new EventSource(url)
    sse.onmessage = e => {
      try {
        const data = JSON.parse(e.data)
        if (data.type === 'init' || data.type === 'update') {
          setView(data.view)
        }
      } catch (_) {}
    }
    return () => sse.close()
  }, [activeThreadId])

  const transcript = view?.entries ? [...view.entries] : []
  const isThinking = !!view?.docs?.['pi.live']?.generation
  const streamingText =
    view?.docs?.['pi.live']?.generation?.message?.content
      ?.filter((c: any) => c.type === 'text')
      ?.map((c: any) => c.text)
      ?.join('') || ''

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [])

  const sendMessage = async (e: any) => {
    e.preventDefault()
    if (!message.trim()) return

    setLoading(true)
    const msg = message
    setMessage('')

    try {
      await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: msg, conversationId: activeThreadId }),
      })
    } finally {
      setLoading(false)
    }
  }

  const forkConversation = async (messageId: string) => {
    if (
      !confirm(
        'Are you sure you want to fork the conversation from this point?'
      )
    )
      return
    try {
      const res = await fetch(`/api/fork/${messageId}`, { method: 'POST' })
      const data = await res.json()
      alert(
        `Forked successfully! Switch to thread #${data.newConversationId} in the sidebar.`
      )
      fetchThreads() // Refresh sidebar
      navigate({
        to: '/chat/thread/$threadId',
        params: { threadId: String(data.newConversationId) },
      })
    } catch (_e) {
      alert('Fork failed')
    }
  }

  const startNewThread = async () => {
    try {
      const res = await fetch('/api/new-thread', { method: 'POST' })
      const data = await res.json()
      if (data.success) {
        fetchThreads()
        navigate({
          to: '/chat/thread/$threadId',
          params: { threadId: String(data.conversationId) },
        })
      }
    } catch (_e) {
      alert('Failed to start new thread')
    }
  }

  return (
    <div className='flex gap-6 h-[85vh]'>
      {/* SECONDARY SIDEBAR: Threads List */}
      <div className='w-64 bg-white shadow rounded-lg border border-gray-200 flex flex-col shrink-0 overflow-y-auto hidden lg:flex'>
        <div className='px-4 py-4 border-b border-gray-200 bg-gray-50 flex items-center justify-between'>
          <h2 className='font-medium text-gray-900 flex items-center gap-2 text-sm'>
            <GitBranch className='w-4 h-4 text-indigo-600' /> Timelines
          </h2>
          <button
            onClick={startNewThread}
            className='text-xs bg-indigo-600 hover:bg-indigo-700 text-white px-2 py-1 rounded shadow-sm flex items-center gap-1'
          >
            + New
          </button>
        </div>
        <ul className='divide-y divide-gray-100 p-2'>
          {threads.map(thread => (
            <li key={thread.id}>
              <button
                onClick={() =>
                  navigate({
                    to: '/chat/thread/$threadId',
                    params: { threadId: String(thread.id) },
                  })
                }
                className={`w-full text-left px-3 py-3 rounded-md text-sm font-medium flex items-center gap-2 transition-colors ${activeThreadId === thread.id ? 'bg-indigo-50 text-indigo-700' : 'text-gray-600 hover:bg-gray-50'}`}
              >
                <Hash className='w-4 h-4 opacity-50' />
                Thread #{thread.id}
                {thread.id === 1 && (
                  <span className='ml-auto text-xs bg-gray-200 text-gray-600 px-1.5 py-0.5 rounded'>
                    Root
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      </div>

      {/* MAIN CHAT AREA */}
      <div className='flex-1 bg-white shadow rounded-lg border border-gray-200 flex flex-col min-w-0'>
        <div className='px-6 py-4 border-b border-gray-200 bg-gray-50 flex items-center justify-between shrink-0'>
          <div className='flex items-center gap-2'>
            <MessageCircle className='w-5 h-5 text-gray-500' />
            <h2 className='text-lg font-medium text-gray-900'>
              Lali{' '}
              <span className='text-gray-400 text-sm font-normal'>
                | Thread #{activeThreadId || '...'}
              </span>
            </h2>
          </div>
        </div>

        <div className='flex-1 p-6 overflow-y-auto bg-white space-y-6'>
          {transcript.map((entry: any) => {
            if (entry.kind === 'pi.user') {
              return (
                <div key={entry.id} className='flex flex-col items-end group'>
                  <div className='bg-indigo-600 text-white rounded-2xl rounded-tr-sm px-4 py-3 max-w-[80%]'>
                    {entry.model?.[0]?.content}
                  </div>
                  <button
                    onClick={() => forkConversation(entry.id)}
                    className='text-xs text-gray-400 hover:text-indigo-600 mt-1 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity'
                  >
                    <GitBranch className='w-3 h-3' /> Fork here
                  </button>
                </div>
              )
            }
            if (entry.kind === 'pi.assistant') {
              const textContent =
                entry.model?.[0]?.content
                  ?.filter((c: any) => c.type === 'text')
                  ?.map((c: any) => c.text)
                  ?.join('') || ''
              const hasTools = entry.model?.[0]?.content?.some(
                (c: any) => c.type === 'toolCall'
              )
              return (
                <div key={entry.id} className='flex flex-col items-start group'>
                  <div className='bg-gray-100 text-gray-900 rounded-2xl rounded-tl-sm px-4 py-3 max-w-[80%]'>
                    {textContent && (
                      <p className='whitespace-pre-wrap'>{textContent}</p>
                    )}
                    {hasTools && (
                      <span className='text-xs font-mono text-purple-600 mt-1 block'>
                        [Used a tool]
                      </span>
                    )}
                  </div>
                  <button
                    onClick={() => forkConversation(entry.id)}
                    className='text-xs text-gray-400 hover:text-indigo-600 mt-1 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity'
                  >
                    <GitBranch className='w-3 h-3' /> Fork here
                  </button>
                </div>
              )
            }
            if (entry.kind === 'pi.tool-result') {
              return (
                <div
                  key={entry.id}
                  className='flex flex-col items-start pl-8 my-2'
                >
                  <div className='bg-purple-50 border border-purple-100 text-purple-800 rounded-lg px-3 py-2 text-xs font-mono max-w-[80%]'>
                    {entry.model?.[0]?.content?.[0]?.text || 'Tool completed.'}
                  </div>
                </div>
              )
            }
            return null
          })}

          {isThinking && (
            <div className='flex flex-col items-start'>
              <div className='bg-gray-100 text-gray-900 rounded-2xl rounded-tl-sm px-4 py-3 max-w-[80%] border border-gray-300'>
                <span className='text-gray-500 animate-pulse flex items-center gap-2'>
                  <div className='w-2 h-2 bg-indigo-500 rounded-full animate-bounce'></div>
                  <div
                    className='w-2 h-2 bg-indigo-500 rounded-full animate-bounce'
                    style={{ animationDelay: '0.1s' }}
                  ></div>
                  <div
                    className='w-2 h-2 bg-indigo-500 rounded-full animate-bounce'
                    style={{ animationDelay: '0.2s' }}
                  ></div>
                </span>
                {streamingText && (
                  <div className='mt-2 text-gray-700 whitespace-pre-wrap'>
                    {streamingText}
                  </div>
                )}
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        <div className='p-4 bg-gray-50 border-t border-gray-200 shrink-0'>
          <form onSubmit={sendMessage} className='flex gap-4'>
            <input
              type='text'
              value={message}
              onChange={e => setMessage(e.target.value)}
              placeholder='Chat with Lali...'
              className='flex-1 rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm p-3 border'
            />
            <button
              type='submit'
              disabled={loading || isThinking}
              className='inline-flex items-center gap-2 px-6 py-3 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50'
            >
              <Send className='w-4 h-4' /> Send
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
