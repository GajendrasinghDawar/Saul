import { createFileRoute } from '@tanstack/react-router'
import { Activity } from 'lucide-react'
import { useEffect, useState } from 'react'
import { fetchWithCsrf } from '../lib/api'

export const Route = createFileRoute('/tasks')({ component: TasksPage })

type Task = {
  id: string
  name: string
  status: string
  state: unknown
}

function TasksPage() {
  const [tasks, setTasks] = useState<Task[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const loadTasks = async () => {
      try {
        const res = await fetch('/api/tasks')
        const data = await res.json()
        if (data.tasks) {
          setTasks(data.tasks)
        }
      } catch (e) {
        console.error(e)
      } finally {
        setLoading(false)
      }
    }
    void loadTasks()
    const interval = setInterval(loadTasks, 2000)
    return () => clearInterval(interval)
  }, [])

  return (
    <main className='flex h-full w-full flex-col bg-slate2 px-4 py-6 md:px-8'>
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
              Live view of Pi-Durable tasks and subagents
            </p>
          </div>
        </header>

        {loading && tasks.length === 0 ? (
          <p className='text-slate11'>Loading tasks...</p>
        ) : tasks.length === 0 ? (
          <div className='flex h-32 items-center justify-center rounded-xl border border-dashed border-slate6 text-sm text-slate10'>
            No running tasks.
          </div>
        ) : (
          <ul className='space-y-3'>
            {tasks.map(task => (
              <li
                key={task.id}
                className='rounded-xl border border-slate5 bg-slate3 p-4 shadow-sm'
              >
                <div className='flex items-center justify-between'>
                  <div>
                    <h3 className='font-semibold text-slate12'>{task.name}</h3>
                    <p className='text-xs text-slate10 font-mono mt-1'>
                      ID: {task.id}
                    </p>
                  </div>
                  <div className='flex items-center gap-2'>
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                        task.status === 'running'
                          ? 'bg-jade4 text-jade11'
                          : task.status === 'terminal'
                            ? 'bg-slate4 text-slate11'
                            : 'bg-yellow4 text-yellow11'
                      }`}
                    >
                      {task.status}
                    </span>
                    {task.status === 'running' && (
                      <button
                        onClick={async () => {
                          try {
                            await fetchWithCsrf(`/api/tasks/${task.id}/abort`, {
                              method: 'POST',
                            })
                          } catch (_e) {
                            alert('Failed to cancel task')
                          }
                        }}
                        className='ml-2 rounded border border-red6 px-2 py-1 text-xs text-red11 hover:bg-red3 transition-colors'
                      >
                        Cancel
                      </button>
                    )}
                  </div>
                </div>
                {task.state?.checkpoint && (
                  <div className='mt-3 rounded bg-slate2 p-2 text-xs font-mono text-slate11 overflow-auto max-h-40'>
                    {JSON.stringify(task.state.checkpoint, null, 2)}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  )
}
