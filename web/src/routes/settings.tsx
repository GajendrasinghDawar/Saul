import { createFileRoute } from '@tanstack/react-router'
import { Trash, Plus, Save, Key } from 'lucide-react'
import { useState, useEffect } from 'react'

export const Route = createFileRoute('/settings')({ component: SettingsPage })

type Secret = {
  name: string
  value: string
  kind: 'secret' | 'env'
  allowedHosts: string | null
  updatedAt: string
}

function SettingsPage() {
  const [secrets, setSecrets] = useState<Secret[]>([])
  const [loading, setLoading] = useState(true)
  const [showAddForm, setShowAddForm] = useState(false)
  const [newSecret, setNewSecret] = useState<Partial<Secret>>({ kind: 'env' })
  const [error, setError] = useState<string | null>(null)
  
  const fetchSecrets = async () => {
    try {
      const res = await fetch('/api/secrets')
      if (res.ok) {
        const data = await res.json()
        setSecrets(data)
      }
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchSecrets()
  }, [])

  const handleDelete = async (name: string) => {
    if (!confirm(`Are you sure you want to delete ${name}?`)) return
    try {
      const res = await fetch(`/api/secrets/${name}`, { method: 'DELETE' })
      if (res.ok) fetchSecrets()
    } catch (e) {
      console.error(e)
    }
  }

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    try {
      const res = await fetch('/api/secrets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newSecret)
      })
      if (res.ok) {
        setShowAddForm(false)
        setNewSecret({ kind: 'env' })
        fetchSecrets()
      } else {
        const data = await res.json()
        setError(data.error || 'Failed to save')
      }
    } catch (e) {
      setError('Network error')
    }
  }

  return (
    <div className='flex h-full flex-col gap-6 p-8 max-w-4xl mx-auto w-full'>
      <div className='flex items-center gap-3 border-b border-slate5 pb-6'>
        <div className='flex size-10 items-center justify-center rounded-lg border border-slate5 bg-slate3 text-slate10'>
          <Key size={20} />
        </div>
        <div>
          <h2 className='text-xl font-semibold text-slate12'>Environment & Secrets</h2>
          <p className='text-sm text-slate10'>
            Manage application settings, API keys, and environment variables.
          </p>
        </div>
      </div>

      <div className='flex justify-between items-center'>
        <h3 className='text-lg font-medium text-slate12'>Configuration</h3>
        <button 
          onClick={() => setShowAddForm(true)}
          className='flex items-center gap-2 bg-slate12 text-slate1 px-3 py-1.5 rounded-md text-sm hover:bg-slate11 transition-colors'
        >
          <Plus size={16} /> Add Variable
        </button>
      </div>

      {showAddForm && (
        <form onSubmit={handleSave} className='bg-slate2 p-4 rounded-lg border border-slate5 flex flex-col gap-4'>
          <div className='grid grid-cols-2 gap-4'>
            <div>
              <label className='block text-xs font-medium text-slate11 mb-1'>Name (e.g. OPENAI_API_KEY)</label>
              <input 
                required
                className='w-full bg-slate1 border border-slate6 rounded px-3 py-2 text-sm text-slate12'
                value={newSecret.name || ''}
                onChange={e => setNewSecret({...newSecret, name: e.target.value.toUpperCase()})}
              />
            </div>
            <div>
              <label className='block text-xs font-medium text-slate11 mb-1'>Value</label>
              <input 
                required
                type={newSecret.kind === 'secret' ? 'password' : 'text'}
                className='w-full bg-slate1 border border-slate6 rounded px-3 py-2 text-sm text-slate12'
                value={newSecret.value || ''}
                onChange={e => setNewSecret({...newSecret, value: e.target.value})}
              />
            </div>
          </div>
          
          <div>
            <label className='block text-xs font-medium text-slate11 mb-2'>Type</label>
            <div className='flex gap-4'>
              <label className='flex items-center gap-2 text-sm text-slate12'>
                <input 
                  type='radio' 
                  checked={newSecret.kind === 'env'}
                  onChange={() => setNewSecret({...newSecret, kind: 'env'})}
                />
                Agent Readable (Environment)
              </label>
              <label className='flex items-center gap-2 text-sm text-slate12'>
                <input 
                  type='radio' 
                  checked={newSecret.kind === 'secret'}
                  onChange={() => setNewSecret({...newSecret, kind: 'secret'})}
                />
                Protected Secret (API Keys)
              </label>
            </div>
          </div>

          {error && <div className='text-red-500 text-sm'>{error}</div>}

          <div className='flex justify-end gap-2 mt-2'>
            <button 
              type='button' 
              onClick={() => setShowAddForm(false)}
              className='px-3 py-1.5 text-sm text-slate11 hover:text-slate12'
            >
              Cancel
            </button>
            <button 
              type='submit'
              className='flex items-center gap-2 bg-slate12 text-slate1 px-3 py-1.5 rounded-md text-sm'
            >
              <Save size={16} /> Save
            </button>
          </div>
        </form>
      )}

      <div className='bg-slate2 rounded-lg border border-slate5 overflow-hidden'>
        <table className='w-full text-left text-sm'>
          <thead className='bg-slate3 border-b border-slate5'>
            <tr>
              <th className='px-4 py-3 font-medium text-slate11'>Name</th>
              <th className='px-4 py-3 font-medium text-slate11'>Type</th>
              <th className='px-4 py-3 font-medium text-slate11'>Value</th>
              <th className='px-4 py-3 font-medium text-slate11 w-16'></th>
            </tr>
          </thead>
          <tbody className='divide-y divide-slate5'>
            {loading ? (
              <tr><td colSpan={4} className='px-4 py-4 text-center text-slate10'>Loading...</td></tr>
            ) : secrets.length === 0 ? (
              <tr><td colSpan={4} className='px-4 py-8 text-center text-slate10'>No configuration found.</td></tr>
            ) : (
              secrets.map(s => (
                <tr key={s.name} className='hover:bg-slate3/50'>
                  <td className='px-4 py-3 font-mono text-slate12'>{s.name}</td>
                  <td className='px-4 py-3'>
                    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${s.kind === 'secret' ? 'bg-orange-500/10 text-orange-500' : 'bg-blue-500/10 text-blue-500'}`}>
                      {s.kind === 'secret' ? 'Protected' : 'Readable'}
                    </span>
                  </td>
                  <td className='px-4 py-3 font-mono text-slate11 max-w-[200px] truncate'>
                    {s.value}
                  </td>
                  <td className='px-4 py-3 text-right'>
                    <button 
                      onClick={() => handleDelete(s.name)}
                      className='text-slate10 hover:text-red-500 transition-colors'
                      title='Delete'
                    >
                      <Trash size={16} />
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
