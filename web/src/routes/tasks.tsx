import { createFileRoute, Link } from '@tanstack/react-router'
import { Activity } from 'lucide-react'
import { useEffect, useState } from 'react'
import { fetchWithCsrf } from '../lib/api'

export const Route = createFileRoute('/tasks')({ component: TasksPage })

type Task = {
  id: number
  kind: string
  conversationId: number
  abortRequested: boolean
  state: {
    status: string
    outcome?: { status: string }
  }
}

const taskNames: Record<string, string> = {
  'pi.generation': 'Assistant response',
  'pi.tool': 'Tool action',
  'pi.compaction': 'Conversation summary',
  'lali.approval': 'Approval decision',
  'lali.reminder': 'Scheduled reminder',
  'lali.subagent-anchor': 'Delegated conversation',
  'lali.subagent-reporter': 'Subagent report',
}

function TasksPage() {
  const [tasks, setTasks] = useState<Task[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    const controller = new AbortController()
    const loadTasks = async () => {
      try {
        const res = await fetch('/api/tasks', {
          signal: controller.signal,
          cache: 'no-store',
        })
        if (!res.ok) throw new Error('Tasks are unavailable. Please try again.')
        const data = await res.json()
        if (!controller.signal.aborted && data.tasks) {
          setTasks(data.tasks)
          setError('')
        }
      } catch (e) {
        if (!controller.signal.aborted)
          setError(e instanceof Error ? e.message : 'Tasks are unavailable.')
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    }
    void loadTasks()
    const interval = setInterval(loadTasks, 2000)
    return () => {
      controller.abort()
      clearInterval(interval)
    }
  }, [])

  return (
    <main className='flex h-full w-full flex-col overflow-y-auto bg-slate2 px-4 py-6 md:px-8'>
      <div className='mx-auto w-full max-w-4xl space-y-6'>
        <header className='flex items-center gap-3 border-b border-slate5 pb-4'>
          <div className='flex size-10 items-center justify-center rounded-lg bg-jade4 text-jade11'>
            <Activity size={20} />
          </div>
          <div>
            <h1 className='text-2xl font-bold text-slate12'>
              Background Tasks
            </h1>
            <p className='text-sm text-slate10'>
              Agent execution steps, reminders and subagents. IDs identify
              steps, not a task count.
            </p>
          </div>
        </header>

        <p className='text-sm text-slate10'>
          Attention collects decisions and results that need you. Tasks shows
          the underlying work, including completed steps—not your saved todo
          list.
        </p>
        {error && (
          <p role='alert' className='text-sm text-red11'>
            {error}
          </p>
        )}
        {loading && tasks.length === 0 ? (
          <p className='text-slate11'>Loading tasks...</p>
        ) : tasks.length === 0 ? (
          <div className='flex h-32 items-center justify-center rounded-xl border border-dashed border-slate6 text-sm text-slate10'>
            No agent tasks recorded.
          </div>
        ) : (
          <ul className='space-y-3'>
            {tasks.map(task => (
              <li
                key={task.id}
                className='rounded-xl border border-slate5 bg-slate3 p-4 shadow-sm'
              >
                <div className='flex flex-wrap items-center justify-between gap-3'>
                  <div>
                    <h3 className='font-semibold text-slate12'>
                      {taskNames[task.kind] ?? 'Agent task'}
                    </h3>
                    <p className='text-xs text-slate10 font-mono mt-1'>
                      ID: {task.id}
                    </p>
                    <Link
                      to='/chat/$sessionId'
                      params={{ sessionId: String(task.conversationId) }}
                      className='mt-2 inline-block text-sm text-jade11 underline'
                    >
                      Open source conversation
                    </Link>
                  </div>
                  <div className='flex items-center gap-2'>
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                        task.state.status === 'running'
                          ? 'bg-jade4 text-jade11'
                          : task.state.status === 'terminal'
                            ? 'bg-slate4 text-slate11'
                            : 'bg-amber4 text-amber11'
                      }`}
                    >
                      {task.abortRequested && task.state.status !== 'terminal'
                        ? 'Cancelling'
                        : task.kind === 'lali.approval' &&
                            task.state.status !== 'terminal'
                          ? 'Waiting for decision'
                          : (task.state.outcome?.status ?? task.state.status)}
                    </span>
                    {['pending', 'running', 'waiting'].includes(
                      task.state.status
                    ) && (
                      <button
                        type='button'
                        disabled={task.abortRequested}
                        onClick={async () => {
                          try {
                            const response = await fetchWithCsrf(
                              `/api/tasks/${task.id}/abort`,
                              {
                                method: 'POST',
                              }
                            )
                            if (!response.ok)
                              throw new Error('Failed to cancel task')
                          } catch (_e) {
                            setError('Failed to cancel task. Try again.')
                          }
                        }}
                        className='ml-2 rounded border border-red6 px-2 py-1 text-xs text-red11 hover:bg-red3 transition-colors'
                      >
                        Cancel
                      </button>
                    )}
                  </div>
                </div>
                <details className='mt-3 text-xs text-slate10'>
                  <summary className='cursor-pointer'>
                    Execution details
                  </summary>
                  <p className='mt-2 break-words font-mono'>
                    Kind: {task.kind} · Conversation: {task.conversationId}
                  </p>
                  <p className='mt-1'>
                    Internal checkpoints and raw provider errors are not
                    displayed here. Open the chat for the action and its result.
                  </p>
                </details>
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  )
}
