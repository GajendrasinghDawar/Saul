import { createFileRoute } from '@tanstack/react-router'
import { Key, Save, Trash } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchWithCsrf } from '../lib/api'

export const Route = createFileRoute('/settings')({ component: SettingsPage })

type Setting = {
  name: string
  kind: 'secret' | 'env'
  value: string | null
  isSet: boolean
  applyMode: 'live' | 'restart'
  pendingRestart: boolean
}

const supportedNames = new Set([
  'AZURE_OPENAI_API_KEY',
  'RESEND_API_KEY',
  'MY_EMAIL_ADDRESS',
  'AZURE_OPENAI_BASE_URL',
  'AZURE_OPENAI_MODEL',
  'AZURE_OPENAI_INPUT',
  'S3_ENDPOINT',
  'S3_REGION',
  'S3_BUCKET',
  'S3_ACCESS_KEY_ID',
  'S3_SECRET_ACCESS_KEY',
])

const protectedNames = new Set(['S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'])

function SettingsPage() {
  const [settings, setSettings] = useState<Setting[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [denied, setDenied] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [deleting, setDeleting] = useState<string | null>(null)
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const mounted = useRef(false)

  const responseError = useCallback((status: number, deletion = false) => {
    if (status === 401) {
      setDrafts({})
      setPassword('')
      setEditing(null)
      setDeleting(null)
      setSettings([])
      setDenied(true)
      return 'Your session has expired. Sign in again to manage settings.'
    }
    if (status === 403) {
      return deletion
        ? 'Deletion was not authorized. Check your current password and permissions, then try again.'
        : 'Settings access was denied. Administrator access and a valid security token are required.'
    }
    return deletion
      ? 'Could not delete this setting. Check your current password and try again.'
      : 'Could not save or load settings. Check the value and try again.'
  }, [])

  const loadSettings = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/secrets')
      if (!mounted.current) return
      if (!res.ok) {
        setSettings([])
        setDenied(res.status === 401 || res.status === 403)
        if (res.status === 401 || res.status === 403) {
          setDrafts({})
          setPassword('')
          setEditing(null)
          setDeleting(null)
        }
        setError(responseError(res.status))
        return
      }
      const data: Setting[] = await res.json()
      if (!mounted.current) return
      // Never retain a secret value, even if a server incorrectly returns one.
      setSettings(
        data
          .filter(s => supportedNames.has(s.name))
          .map(s => ({
            ...s,
            value:
              s.kind === 'secret' ||
              s.name.endsWith('_API_KEY') ||
              protectedNames.has(s.name)
                ? null
                : s.value,
          }))
      )
      setDenied(false)
    } catch {
      if (mounted.current)
        setError('Could not load settings. Check your connection and retry.')
    } finally {
      if (mounted.current) setLoading(false)
    }
  }, [responseError])

  useEffect(() => {
    mounted.current = true
    void loadSettings()
    // Drafts exist only in this component; navigating away (including sign-out)
    // destroys them. Ignore responses arriving after unmount.
    return () => {
      mounted.current = false
    }
  }, [loadSettings])

  const mutate = async (setting: Setting, remove: boolean) => {
    if (busy) return
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const res = await fetchWithCsrf(
        remove
          ? `/api/secrets/${encodeURIComponent(setting.name)}`
          : '/api/secrets',
        {
          method: remove ? 'DELETE' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(
            remove
              ? { password }
              : { name: setting.name, value: drafts[setting.name] ?? '' }
          ),
        }
      )
      if (!mounted.current) return
      setPassword('')
      if (!res.ok) {
        setError(responseError(res.status, remove))
        return
      }
      const result: {
        applyMode: Setting['applyMode']
        pendingRestart: boolean
      } = await res.json()
      if (!mounted.current) return
      setDrafts(current => {
        const next = { ...current }
        delete next[setting.name]
        return next
      })
      setEditing(null)
      setDeleting(null)
      setNotice(
        `${setting.name} ${remove ? 'override removed' : 'saved'}. ${result.pendingRestart ? 'Restart required through your deployment or administrator.' : result.applyMode === 'live' ? 'Active now.' : 'No restart pending.'}`
      )
      // Removing an override can reveal an environment fallback. Read the
      // effective server state rather than guessing that the value is unset.
      await loadSettings()
    } catch {
      if (mounted.current) {
        setPassword('')
        setError(
          'Could not complete the change. Check your connection and try again.'
        )
      }
    } finally {
      if (mounted.current) setBusy(false)
    }
  }

  const inputClass =
    'w-full rounded border border-slate6 bg-slate1 px-3 py-2 text-sm text-slate12'
  const buttonClass =
    'rounded-md border border-slate6 px-3 py-1.5 text-sm text-slate11 hover:bg-slate3 disabled:opacity-50'

  return (
    <div className='mx-auto flex h-full w-full max-w-4xl flex-col gap-6 overflow-y-auto p-4 md:p-8'>
      <header className='flex items-center gap-3 border-b border-slate5 pb-6'>
        <div className='flex size-10 shrink-0 items-center justify-center rounded-lg border border-slate5 bg-slate3 text-slate10'>
          <Key size={20} />
        </div>
        <div>
          <h2 className='text-xl font-semibold text-slate12'>
            Environment & Secrets
          </h2>
          <p className='text-sm text-slate10'>
            Manage supported server settings and protected API keys.
          </p>
        </div>
      </header>
      <p className='text-sm text-slate11'>
        Bootstrap keys cannot be changed here. Settings marked “Restart
        required” take effect only after a deployment or administrator restarts
        the server.
      </p>
      {error && (
        <div
          role='alert'
          className='rounded-lg border border-crimson6 bg-crimson3 p-4 text-sm text-crimson11'
        >
          {error}
        </div>
      )}
      {notice && (
        <p role='status' className='text-sm text-slate11'>
          {notice}
        </p>
      )}
      {loading ? (
        <p role='status' className='text-sm text-slate10'>
          Loading settings...
        </p>
      ) : (
        <>
          {(error || denied || settings.length === 0) && (
            <button
              type='button'
              disabled={busy}
              onClick={() => void loadSettings()}
              className={`${buttonClass} self-start`}
            >
              Retry loading settings
            </button>
          )}
          {!denied &&
            settings.map(setting => {
              const protectedKey =
                setting.kind === 'secret' ||
                setting.name.endsWith('_API_KEY') ||
                protectedNames.has(setting.name)
              return (
                <section
                  key={setting.name}
                  className='rounded-lg border border-slate5 bg-slate2 p-4'
                >
                  <div className='flex flex-wrap items-start justify-between gap-3'>
                    <div className='min-w-0'>
                      <h3 className='break-all font-mono text-sm font-medium text-slate12'>
                        {setting.name}
                      </h3>
                      <p className='mt-1 text-sm text-slate11'>
                        {setting.isSet ? 'Configured' : 'Not configured'}
                        {protectedKey ? ' · Protected key' : ''}
                      </p>
                      {!protectedKey && setting.isSet && (
                        <p className='mt-1 break-all text-sm text-slate11'>
                          {setting.value}
                        </p>
                      )}
                      <p
                        className={`mt-2 text-xs ${setting.pendingRestart ? 'text-crimson11' : 'text-slate10'}`}
                      >
                        {setting.pendingRestart
                          ? 'Restart required'
                          : setting.isSet && setting.applyMode === 'live'
                            ? 'Active now'
                            : setting.applyMode === 'restart'
                              ? 'Changes require restart'
                              : 'Changes apply live'}
                      </p>
                    </div>
                    <div className='flex gap-2'>
                      <button
                        type='button'
                        disabled={busy}
                        onClick={() => {
                          setDrafts({})
                          setEditing(setting.name)
                          setDeleting(null)
                          setPassword('')
                          setError(null)
                          setNotice(null)
                        }}
                        className={buttonClass}
                      >
                        {setting.isSet ? 'Replace' : 'Set value'}
                      </button>
                      {setting.isSet && (
                        <button
                          type='button'
                          disabled={busy}
                          aria-label={`Delete ${setting.name}`}
                          onClick={() => {
                            setDrafts({})
                            setDeleting(setting.name)
                            setEditing(null)
                            setPassword('')
                            setError(null)
                            setNotice(null)
                          }}
                          className={`${buttonClass} hover:text-crimson11`}
                        >
                          <Trash size={16} />
                        </button>
                      )}
                    </div>
                  </div>
                  {editing === setting.name && (
                    <form
                      className='mt-4 flex flex-col gap-3 border-t border-slate5 pt-4'
                      onSubmit={e => {
                        e.preventDefault()
                        void mutate(setting, false)
                      }}
                    >
                      <label
                        htmlFor={`value-${setting.name}`}
                        className='text-sm text-slate11'
                      >
                        {protectedKey
                          ? 'New key (existing key is never shown)'
                          : 'New value'}
                      </label>
                      <input
                        id={`value-${setting.name}`}
                        placeholder={
                          setting.name === 'AZURE_OPENAI_INPUT'
                            ? 'text or text,image'
                            : undefined
                        }
                        pattern={
                          setting.name === 'AZURE_OPENAI_INPUT'
                            ? 'text(,image)?'
                            : undefined
                        }
                        required
                        disabled={busy}
                        type={protectedKey ? 'password' : 'text'}
                        autoComplete='off'
                        spellCheck={false}
                        value={drafts[setting.name] ?? ''}
                        onChange={e =>
                          setDrafts(current => ({
                            ...current,
                            [setting.name]: e.target.value,
                          }))
                        }
                        className={inputClass}
                      />
                      <div className='flex justify-end gap-2'>
                        <button
                          type='button'
                          disabled={busy}
                          onClick={() => {
                            setDrafts({})
                            setEditing(null)
                          }}
                          className={buttonClass}
                        >
                          Cancel
                        </button>
                        <button
                          type='submit'
                          disabled={busy}
                          className='flex items-center gap-2 rounded-md bg-slate12 px-3 py-1.5 text-sm text-slate1 disabled:opacity-50'
                        >
                          <Save size={16} />
                          {busy ? 'Saving...' : 'Save'}
                        </button>
                      </div>
                    </form>
                  )}
                  {deleting === setting.name && (
                    <form
                      className='mt-4 flex flex-col gap-3 border-t border-slate5 pt-4'
                      onSubmit={e => {
                        e.preventDefault()
                        void mutate(setting, true)
                      }}
                    >
                      <p className='text-sm text-slate11'>
                        Confirm deletion of {setting.name}. This removes the
                        server-managed value. An external fallback, if set,
                        remains active.
                      </p>
                      <label
                        htmlFor={`password-${setting.name}`}
                        className='text-sm text-slate11'
                      >
                        Current account password
                      </label>
                      <input
                        id={`password-${setting.name}`}
                        type='password'
                        autoComplete='current-password'
                        required
                        disabled={busy}
                        value={password}
                        onChange={e => setPassword(e.target.value)}
                        className={inputClass}
                      />
                      <div className='flex justify-end gap-2'>
                        <button
                          type='button'
                          disabled={busy}
                          onClick={() => {
                            setDeleting(null)
                            setPassword('')
                          }}
                          className={buttonClass}
                        >
                          Cancel
                        </button>
                        <button
                          type='submit'
                          disabled={busy}
                          className='rounded-md border border-crimson6 bg-crimson3 px-3 py-1.5 text-sm text-crimson11 disabled:opacity-50'
                        >
                          {busy ? 'Deleting...' : 'Confirm deletion'}
                        </button>
                      </div>
                    </form>
                  )}
                </section>
              )
            })}
        </>
      )}
    </div>
  )
}
