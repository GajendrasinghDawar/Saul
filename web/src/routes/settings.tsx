import {
  createFileRoute,
  Link,
  Outlet,
  useRouterState,
} from '@tanstack/react-router'
import { Check, KeyRound, Plus, Search, Settings2 } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { AzureConnection } from '../components/ai-settings/azure-connection'
import { CustomConnection } from '../components/ai-settings/custom-connection'
import { ScrollArea } from '../components/ui/scroll-area'
import {
  aiRequest,
  type LoginState,
  type Model,
  providerPath,
  type Settings,
  SettingsError,
  safeUrl,
} from '../lib/ai-settings'

export const Route = createFileRoute('/settings')({ component: SettingsPage })
const button =
  'rounded-md border border-slate6 px-3 py-2 text-sm text-slate11 hover:bg-slate3 disabled:opacity-50'
const primaryButton =
  'rounded-md border border-slate8 bg-slate12 px-3 py-2 text-sm text-slate1 hover:bg-slate11 disabled:opacity-50'
const input =
  'w-full min-w-0 rounded-md border border-slate6 bg-slate1 px-3 py-2 text-sm text-slate12'

function SettingsPage() {
  const section = useRouterState({
    select: state =>
      state.matches.some(
        match => match.routeId === '/settings/environment-variables'
      )
        ? 'environment'
        : state.matches.some(
              match => match.routeId === '/settings/ai-providers'
            )
          ? 'ai'
          : 'overview',
  })
  const [data, setData] = useState<Settings | null>(null)
  const [selected, setSelected] = useState('')
  const [query, setQuery] = useState('')
  const [modelQuery, setModelQuery] = useState('')
  const [models, setModels] = useState<Model[]>([])
  const [modelsLoading, setModelsLoading] = useState(false)
  const [modelsFailed, setModelsFailed] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [login, setLogin] = useState<LoginState | null>(null)
  const [answer, setAnswer] = useState({ promptId: '', value: '' })
  const [custom, setCustom] = useState<'new' | 'edit' | null>(null)
  const [confirm, setConfirm] = useState<'disconnect' | 'delete' | null>(null)
  const mounted = useRef(false)
  const loginRef = useRef<LoginState | null>(null)
  loginRef.current = login
  const provider = data?.providers.find(p => p.id === selected)

  const fail = useCallback((cause: unknown) => {
    if (
      !mounted.current ||
      (cause instanceof DOMException && cause.name === 'AbortError')
    )
      return
    setError(
      cause instanceof SettingsError
        ? cause.message
        : 'Request failed. Check your connection and retry.'
    )
    setAnswer({ promptId: '', value: '' })
    if (
      cause instanceof SettingsError &&
      (cause.status === 401 || cause.status === 403)
    ) {
      setData(null)
      setModels([])
      setLogin(null)
      setCustom(null)
      setConfirm(null)
    }
  }, [])
  const refresh = useCallback(async (signal?: AbortSignal) => {
    const next = await aiRequest<Settings>('/', 'GET', undefined, signal)
    if (!mounted.current || signal?.aborted) return
    setData(next)
    setSelected(current =>
      next.providers.some(p => p.id === current)
        ? current
        : (next.defaultModel?.provider ?? next.providers[0]?.id ?? '')
    )
  }, [])
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      const active = loginRef.current
      if (active?.status === 'pending')
        void aiRequest(
          `/logins/${encodeURIComponent(active.id)}`,
          'DELETE'
        ).catch(() => {})
    }
  }, [])
  useEffect(() => {
    if (section !== 'ai' || data) return
    const controller = new AbortController()
    void refresh(controller.signal).catch(fail)
    return () => controller.abort()
  }, [section, data, refresh, fail])
  useEffect(() => {
    if (section !== 'ai' || !selected || !data) return
    const controller = new AbortController()
    setModels([])
    setModelsLoading(true)
    setModelsFailed(false)
    void aiRequest<{ models: Model[] }>(
      `${providerPath(selected)}/models`,
      'GET',
      undefined,
      controller.signal
    )
      .then(result => {
        if (!controller.signal.aborted) setModels(result.models)
      })
      .catch(cause => {
        if (!controller.signal.aborted) setModelsFailed(true)
        fail(cause)
      })
      .finally(() => {
        if (!controller.signal.aborted) setModelsLoading(false)
      })
    return () => controller.abort()
  }, [section, selected, data, fail])
  const acceptLogin = useCallback(
    (state: LoginState) => {
      if (!mounted.current) {
        if (state.status === 'pending')
          void aiRequest(
            `/logins/${encodeURIComponent(state.id)}`,
            'DELETE'
          ).catch(() => {})
        return
      }
      if (
        loginRef.current?.prompt?.id !== state.prompt?.id ||
        state.status !== 'pending'
      )
        setAnswer({ promptId: '', value: '' })
      loginRef.current = state
      setLogin(state)
      if (state.status === 'complete') {
        setNotice('Credentials configured. This does not verify a connection.')
        void refresh().catch(fail)
      } else if (state.status === 'error')
        setError(
          state.error && !/[<>]/.test(state.error)
            ? state.error
            : 'Provider login failed. Please retry.'
        )
    },
    [refresh, fail]
  )
  const activeId = login?.status === 'pending' ? login.id : undefined
  useEffect(() => {
    if (!activeId || busy) return
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout>
    const poll = async () => {
      try {
        const state = await aiRequest<LoginState>(
          `/logins/${encodeURIComponent(activeId)}`,
          'GET',
          undefined,
          controller.signal
        )
        if (controller.signal.aborted) return
        acceptLogin(state)
        if (state.status === 'pending')
          timer = setTimeout(() => void poll(), 1500)
      } catch (cause) {
        fail(cause)
      }
    }
    timer = setTimeout(() => void poll(), 1500)
    return () => {
      controller.abort()
      clearTimeout(timer)
    }
  }, [activeId, busy, acceptLogin, fail])
  const run = async (operation: () => Promise<void>) => {
    if (busy) return
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await operation()
    } catch (cause) {
      fail(cause)
    } finally {
      if (mounted.current) setBusy(false)
    }
  }
  const cancelLogin = async () => {
    const active = loginRef.current
    loginRef.current = null
    setAnswer({ promptId: '', value: '' })
    setLogin(null)
    if (active?.status === 'pending')
      await aiRequest(`/logins/${encodeURIComponent(active.id)}`, 'DELETE')
  }

  return (
    <ScrollArea aria-label='Settings' className='h-full min-h-0 w-full min-w-0'>
      <div className='mx-auto flex w-full min-w-0 max-w-6xl flex-col gap-5 p-4 md:p-8'>
        <header className='flex items-center gap-3 border-b border-slate5 pb-5'>
          <Settings2 size={22} className='shrink-0 text-slate10' />
          <div>
            <h2 className='text-xl font-semibold text-slate12'>Settings</h2>
            <p className='text-sm text-slate10'>
              Manage your AI connections and deployment configuration.
            </p>
          </div>
        </header>
        <nav
          aria-label='Settings sections'
          className='flex flex-wrap gap-2 border-b border-slate5 pb-4'
        >
          {(
            [
              ['overview', 'Overview', '/settings'],
              ['ai', 'AI providers', '/settings/ai-providers'],
              ['environment', 'Environment', '/settings/environment-variables'],
            ] as const
          ).map(([id, label, to]) => (
            <Link
              key={id}
              to={to}
              aria-current={section === id ? 'page' : undefined}
              className={`${button} ${section === id ? 'border-slate8 bg-slate3 text-slate12' : ''}`}
            >
              {label}
            </Link>
          ))}
        </nav>
        <Outlet />
        <section
          hidden={section !== 'environment'}
          aria-label='Environment'
          className='space-y-5'
        >
          <div>
            <h3 className='text-lg font-medium text-slate12'>
              Environment & deployment
            </h3>
            <p className='mt-1 text-sm text-slate10'>
              Read-only guidance for the server administrator.
            </p>
          </div>
          <div className='rounded-lg border border-slate5 bg-slate2 p-5 text-sm text-slate11'>
            <h4 className='font-medium text-slate12'>
              Configured outside Saul
            </h4>
            <p className='mt-2'>
              Infrastructure settings and environment secrets belong in the
              server’s .env file, not in this interface. Their values are never
              displayed or requested here.
            </p>
            <ol className='mt-4 list-decimal space-y-2 pl-5'>
              <li>
                Use the deployment README to identify the configuration your
                server needs.
              </li>
              <li>
                Update the .env file securely on the server. Never paste
                environment secrets into chat.
              </li>
              <li>Restart the deployment to apply environment changes.</li>
            </ol>
            <p className='mt-4 border-t border-slate5 pt-4 text-slate10'>
              Looking for a provider login, custom endpoint, or Azure model
              mapping? Use AI providers. Those connections are managed
              separately from deployment settings.
            </p>
          </div>
        </section>
        <section
          hidden={section !== 'ai'}
          aria-label='AI providers'
          className='min-w-0 space-y-5'
        >
          <div>
            <h3 className='text-lg font-medium text-slate12'>AI providers</h3>
            <p className='mt-1 text-sm text-slate10'>
              Connect a provider, then choose a model for new chats.
            </p>
          </div>
          <div className='rounded-lg border border-slate5 bg-slate2 p-4 text-sm text-slate11'>
            <p className='break-words'>
              Default for new chats:{' '}
              <strong className='text-slate12'>
                {data?.defaultModel
                  ? `${data.defaultModel.provider} / ${data.defaultModel.modelId}`
                  : 'Not selected'}
              </strong>
            </p>
            <p className='mt-1'>Existing chats keep their model.</p>
          </div>
          {error && (
            <p
              role='alert'
              className='break-words rounded-lg border border-crimson6 bg-crimson3 p-3 text-sm text-crimson11'
            >
              {error}
            </p>
          )}
          {notice && (
            <p role='status' className='text-sm text-slate11'>
              {notice}
            </p>
          )}
          {!data ? (
            <div>
              <p className='text-sm text-slate10'>
                {error ? 'Settings unavailable.' : 'Loading settings…'}
              </p>
              {error && (
                <button
                  className={button}
                  type='button'
                  onClick={() => void run(() => refresh())}
                >
                  Retry
                </button>
              )}
            </div>
          ) : (
            <>
              <div className='flex flex-wrap items-center justify-between gap-3'>
                <h3 className='font-medium text-slate12'>Providers</h3>
                <button
                  type='button'
                  disabled={busy}
                  className={`${button} flex items-center gap-2`}
                  onClick={() =>
                    void run(async () => {
                      await cancelLogin()
                      setCustom('new')
                      setConfirm(null)
                    })
                  }
                >
                  <Plus size={16} />
                  Custom connection
                </button>
              </div>
              <div className='grid min-w-0 gap-5 md:grid-cols-[240px_minmax(0,1fr)]'>
                <aside className='min-w-0'>
                  <label className='block text-sm text-slate11 md:hidden'>
                    Provider
                    <select
                      aria-label='Provider'
                      className={`${input} mt-2`}
                      value={selected}
                      disabled={busy}
                      onChange={event => {
                        const id = event.target.value
                        void run(async () => {
                          await cancelLogin()
                          setSelected(id)
                          setCustom(null)
                          setConfirm(null)
                          setModelQuery('')
                        })
                      }}
                    >
                      {data.providers.map(p => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className='hidden md:block'>
                    <label className='relative block'>
                      <Search
                        size={16}
                        className='absolute left-3 top-3 text-slate9'
                      />
                      <input
                        aria-label='Search providers'
                        className={`${input} pl-9`}
                        placeholder='Search providers'
                        value={query}
                        onChange={e => setQuery(e.target.value)}
                      />
                    </label>
                    <ScrollArea
                      aria-label='Providers'
                      className='mt-3 h-[480px] min-h-0 min-w-0'
                    >
                      <div className='flex min-w-0 flex-col gap-1'>
                        {data.providers
                          .filter(p =>
                            `${p.name} ${p.id}`
                              .toLowerCase()
                              .includes(query.toLowerCase())
                          )
                          .map(p => (
                            <button
                              key={p.id}
                              type='button'
                              disabled={busy}
                              aria-pressed={selected === p.id}
                              className={`min-w-0 rounded-md border px-3 py-2 text-left ${selected === p.id ? 'border-slate8 bg-slate3' : 'border-transparent hover:bg-slate2'}`}
                              onClick={() =>
                                void run(async () => {
                                  await cancelLogin()
                                  setSelected(p.id)
                                  setCustom(null)
                                  setConfirm(null)
                                  setModelQuery('')
                                })
                              }
                            >
                              <span className='block break-words text-sm font-medium text-slate12'>
                                {p.name}
                              </span>
                              <span className='mt-1 block text-xs text-slate10'>
                                {p.custom ? 'Custom · ' : ''}
                                {p.keyless
                                  ? 'Keyless connection'
                                  : p.auth.configured
                                    ? 'Credentials configured'
                                    : 'Not configured'}
                              </span>
                            </button>
                          ))}
                        {!data.providers.some(p =>
                          `${p.name} ${p.id}`
                            .toLowerCase()
                            .includes(query.toLowerCase())
                        ) && (
                          <p className='p-3 text-sm text-slate10'>
                            No matching providers.
                          </p>
                        )}
                      </div>
                    </ScrollArea>
                  </div>
                </aside>
                <div className='min-w-0'>
                  {custom && (
                    <CustomConnection
                      key={`${custom}-${selected}`}
                      provider={custom === 'edit' ? provider : undefined}
                      models={custom === 'edit' ? models : []}
                      apis={data.customApis}
                      busy={busy}
                      onCancel={() => setCustom(null)}
                      onSave={(id, body) =>
                        void run(async () => {
                          await aiRequest(providerPath(id), 'PUT', body)
                          setCustom(null)
                          await refresh()
                          setSelected(id)
                          setNotice(
                            'Custom connection saved. Review its credential status before choosing a default.'
                          )
                        })
                      }
                    />
                  )}
                  {!custom && provider && (
                    <section
                      key={provider.id}
                      className='min-w-0 rounded-lg border border-slate5 bg-slate2 p-4'
                    >
                      <div className='flex flex-wrap items-start justify-between gap-3'>
                        <div className='min-w-0'>
                          <h3 className='break-words text-lg font-medium text-slate12'>
                            {provider.name}
                          </h3>
                          <p className='mt-1 text-xs text-slate10'>
                            {provider.keyless
                              ? 'No credentials required · Connection not verified'
                              : provider.auth.configured
                                ? 'Credentials configured · Connection not verified'
                                : 'Credentials not configured'}
                          </p>
                          {provider.auth.source && (
                            <p className='mt-1 break-words text-xs text-slate10'>
                              Source: {provider.auth.source}
                            </p>
                          )}
                          {provider.baseUrl && (
                            <p className='mt-2 break-all text-xs text-slate10'>
                              {provider.baseUrl}
                            </p>
                          )}
                        </div>
                        {provider.custom && (
                          <button
                            type='button'
                            className={button}
                            disabled={
                              busy ||
                              modelsLoading ||
                              modelsFailed ||
                              !!activeId
                            }
                            onClick={() => setCustom('edit')}
                          >
                            Edit connection
                          </button>
                        )}
                      </div>
                      <details
                        open={
                          (!provider.auth.configured && !provider.keyless) ||
                          !!activeId ||
                          undefined
                        }
                        className='mt-4 border-t border-slate5 pt-4'
                      >
                        <summary className='cursor-pointer text-sm font-medium text-slate12'>
                          Connection & credentials
                        </summary>
                        <div className='mt-4 flex flex-wrap gap-2'>
                          {provider.authMethods.map(method => (
                            <button
                              type='button'
                              key={method.type}
                              className={`${button} flex items-center gap-2`}
                              disabled={busy || !!activeId}
                              onClick={() =>
                                void run(async () => {
                                  setAnswer({ promptId: '', value: '' })
                                  const state = await aiRequest<LoginState>(
                                    `${providerPath(selected)}/login`,
                                    'POST',
                                    { method: method.type }
                                  )
                                  acceptLogin(state)
                                })
                              }
                            >
                              <KeyRound size={14} />
                              {method.label}
                            </button>
                          ))}
                          {provider.auth.configured && !provider.keyless && (
                            <button
                              type='button'
                              className={button}
                              disabled={busy || !!activeId}
                              onClick={() => setConfirm('disconnect')}
                            >
                              Disconnect
                            </button>
                          )}
                          {provider.custom && (
                            <button
                              type='button'
                              className={button}
                              disabled={
                                busy ||
                                !!activeId ||
                                data.defaultModel?.provider === selected
                              }
                              onClick={() => setConfirm('delete')}
                            >
                              Delete connection
                            </button>
                          )}
                        </div>
                        {!provider.authMethods.length && !provider.keyless && (
                          <p className='mt-3 text-sm text-slate10'>
                            This provider uses ambient credentials from the
                            server environment or its native credential chain.
                            Configure them through your deployment
                            administrator.
                          </p>
                        )}
                        {confirm && (
                          <div className='mt-4 rounded-md border border-slate6 p-3'>
                            <p className='text-sm text-slate11'>
                              {confirm === 'disconnect'
                                ? 'Remove stored credentials? An environment fallback may remain configured.'
                                : `Delete ${provider.name} and its custom model catalog?`}
                            </p>
                            <div className='mt-3 flex flex-wrap gap-2'>
                              <button
                                type='button'
                                className={button}
                                disabled={busy}
                                onClick={() => setConfirm(null)}
                              >
                                Cancel
                              </button>
                              <button
                                type='button'
                                className={button}
                                disabled={busy}
                                onClick={() =>
                                  void run(async () => {
                                    await aiRequest(
                                      `${providerPath(selected)}${confirm === 'disconnect' ? '/credential' : ''}`,
                                      'DELETE'
                                    )
                                    setConfirm(null)
                                    await refresh()
                                    setNotice(
                                      'Change saved. Effective credential status has been refreshed.'
                                    )
                                  })
                                }
                              >
                                Confirm {confirm}
                              </button>
                            </div>
                          </div>
                        )}
                        {login?.providerId === selected && (
                          <div className='mt-4 rounded-lg border border-slate6 bg-slate1 p-4'>
                            <h4 className='text-sm font-medium text-slate12'>
                              Provider login · {login.status}
                            </h4>
                            <div className='mt-3 space-y-3 break-words text-sm text-slate11'>
                              {login.events.map((event, index) => (
                                // biome-ignore lint/suspicious/noArrayIndexKey: Native events are an append-only log with no event IDs or local row state.
                                <div key={`${event.type}-${index}`}>
                                  {'message' in event && (
                                    <p className='whitespace-pre-wrap'>
                                      {event.message}
                                    </p>
                                  )}
                                  {event.type === 'auth_url' && (
                                    <>
                                      <p>{event.instructions}</p>
                                      <AuthLink url={event.url} />
                                    </>
                                  )}
                                  {event.type === 'device_code' && (
                                    <>
                                      <p>
                                        Device code:{' '}
                                        <strong className='select-all font-mono text-slate12'>
                                          {event.userCode}
                                        </strong>
                                      </p>
                                      <AuthLink url={event.verificationUri} />
                                    </>
                                  )}
                                  {event.type === 'info' &&
                                    event.links?.map(link => (
                                      <AuthLink
                                        key={link.url}
                                        url={link.url}
                                        label={link.label}
                                      />
                                    ))}
                                </div>
                              ))}
                            </div>
                            {login.status === 'pending' && login.prompt && (
                              <form
                                key={login.prompt.id}
                                className='mt-4 space-y-3'
                                onSubmit={e => {
                                  e.preventDefault()
                                  const promptId = login.prompt?.id
                                  const value = answer.value
                                  if (
                                    !promptId ||
                                    answer.promptId !== promptId ||
                                    loginRef.current?.prompt?.id !== promptId
                                  )
                                    return
                                  setAnswer({ promptId: '', value: '' })
                                  void run(async () => {
                                    acceptLogin(
                                      await aiRequest<LoginState>(
                                        `/logins/${encodeURIComponent(login.id)}/answer`,
                                        'POST',
                                        { promptId, value }
                                      )
                                    )
                                  })
                                }}
                              >
                                <label
                                  htmlFor='login-answer'
                                  className='block whitespace-pre-wrap text-sm text-slate11'
                                >
                                  {login.prompt.message}
                                </label>
                                {login.prompt.type === 'select' ? (
                                  <>
                                    <select
                                      id='login-answer'
                                      required
                                      className={input}
                                      disabled={busy}
                                      value={
                                        answer.promptId === login.prompt.id
                                          ? answer.value
                                          : ''
                                      }
                                      onChange={e =>
                                        setAnswer({
                                          promptId: login.prompt?.id ?? '',
                                          value: e.target.value,
                                        })
                                      }
                                    >
                                      <option value=''>Choose an option</option>
                                      {login.prompt.options?.map(option => (
                                        <option
                                          key={option.id}
                                          value={option.id}
                                        >
                                          {option.label}
                                        </option>
                                      ))}
                                    </select>
                                    {login.prompt.options?.map(
                                      option =>
                                        option.description && (
                                          <p
                                            key={option.id}
                                            className='text-xs text-slate10'
                                          >
                                            {option.label}: {option.description}
                                          </p>
                                        )
                                    )}
                                  </>
                                ) : (
                                  <input
                                    id='login-answer'
                                    required
                                    type={
                                      login.prompt.type === 'secret'
                                        ? 'password'
                                        : 'text'
                                    }
                                    autoComplete='off'
                                    spellCheck={false}
                                    disabled={busy}
                                    className={input}
                                    placeholder={login.prompt.placeholder}
                                    value={
                                      answer.promptId === login.prompt.id
                                        ? answer.value
                                        : ''
                                    }
                                    onChange={e =>
                                      setAnswer({
                                        promptId: login.prompt?.id ?? '',
                                        value: e.target.value,
                                      })
                                    }
                                  />
                                )}
                                <button
                                  type='submit'
                                  className={button}
                                  disabled={
                                    busy ||
                                    answer.promptId !== login.prompt.id ||
                                    !answer.value
                                  }
                                >
                                  Continue
                                </button>
                              </form>
                            )}
                            <button
                              type='button'
                              className={`${button} mt-3`}
                              disabled={busy}
                              onClick={() => void run(cancelLogin)}
                            >
                              {login.status === 'pending'
                                ? 'Cancel login'
                                : 'Dismiss'}
                            </button>
                          </div>
                        )}
                        {provider.id === 'azure' && (
                          <AzureConnection
                            key={JSON.stringify(provider.azure)}
                            connection={provider.azure}
                            models={models}
                            busy={
                              busy ||
                              modelsLoading ||
                              modelsFailed ||
                              !!activeId
                            }
                            onSave={connection =>
                              void run(async () => {
                                await aiRequest(
                                  `${providerPath(selected)}/connection`,
                                  'PUT',
                                  connection
                                )
                                await refresh()
                                setNotice(
                                  'Azure connection saved. Check credential status, then choose a default model.'
                                )
                              })
                            }
                          />
                        )}
                      </details>
                      <details className='mt-5 border-t border-slate5 pt-4'>
                        <summary className='cursor-pointer text-sm font-medium text-slate12'>
                          Model catalog{' '}
                          {modelsLoading ? '' : `(${models.length})`} · Choose
                          default
                        </summary>
                        <p className='mt-1 text-xs text-slate10'>
                          Choose a model for new chats. Providers that require
                          credentials must be configured first.
                        </p>
                        <input
                          aria-label='Filter models'
                          className={`${input} mt-3`}
                          placeholder='Filter by model name or ID'
                          value={modelQuery}
                          onChange={e => setModelQuery(e.target.value)}
                        />
                        {modelsFailed && (
                          <button
                            type='button'
                            className={`${button} mt-3`}
                            disabled={busy}
                            onClick={() => void run(() => refresh())}
                          >
                            Retry model catalog
                          </button>
                        )}
                        {modelsLoading ? (
                          <p
                            role='status'
                            className='mt-4 text-sm text-slate10'
                          >
                            Loading model catalog…
                          </p>
                        ) : (
                          <ScrollArea
                            aria-label='Model catalog'
                            className='mt-3 h-[min(500px,60vh)] min-h-0 min-w-0'
                          >
                            {models
                              .filter(m =>
                                `${m.name} ${m.id}`
                                  .toLowerCase()
                                  .includes(modelQuery.toLowerCase())
                              )
                              .map(model => {
                                const isDefault =
                                  data.defaultModel?.provider === selected &&
                                  data.defaultModel.modelId === model.id
                                return (
                                  <div
                                    key={model.id}
                                    className='flex flex-wrap items-center justify-between gap-3 border-b border-slate5 py-3'
                                  >
                                    <div className='min-w-0 flex-1'>
                                      <p className='break-words text-sm font-medium text-slate12'>
                                        {model.name}
                                      </p>
                                      <p className='break-all text-xs text-slate10'>
                                        {model.id}
                                      </p>
                                      <p className='mt-1 text-xs text-slate10'>
                                        {model.input.includes('image')
                                          ? 'Text + image'
                                          : 'Text'}
                                        {model.reasoning ? ' · Reasoning' : ''}{' '}
                                        · {model.contextWindow.toLocaleString()}{' '}
                                        context ·{' '}
                                        {model.maxTokens.toLocaleString()}{' '}
                                        output
                                      </p>
                                    </div>
                                    <button
                                      type='button'
                                      className={`${isDefault ? button : primaryButton} flex shrink-0 items-center gap-1`}
                                      disabled={
                                        busy ||
                                        isDefault ||
                                        (!provider.auth.configured &&
                                          !provider.keyless)
                                      }
                                      onClick={() =>
                                        void run(async () => {
                                          await aiRequest('/default', 'PUT', {
                                            provider: selected,
                                            modelId: model.id,
                                          })
                                          await refresh()
                                          setNotice(
                                            'Default saved for new chats. Existing chats keep their model.'
                                          )
                                        })
                                      }
                                    >
                                      {isDefault && <Check size={14} />}
                                      {isDefault ? 'Default' : 'Use as default'}
                                    </button>
                                  </div>
                                )
                              })}
                            {!models.some(m =>
                              `${m.name} ${m.id}`
                                .toLowerCase()
                                .includes(modelQuery.toLowerCase())
                            ) && (
                              <p className='py-4 text-sm text-slate10'>
                                No matching models.
                              </p>
                            )}
                          </ScrollArea>
                        )}
                      </details>
                    </section>
                  )}
                </div>
              </div>
            </>
          )}
        </section>
      </div>
    </ScrollArea>
  )
}

function AuthLink({ url, label }: { url: string; label?: string }) {
  const href = safeUrl(url)
  return href ? (
    <a
      href={href}
      target='_blank'
      rel='noopener noreferrer'
      className='block break-all text-slate12 underline underline-offset-4'
    >
      {label || 'Open provider authorization page'}
    </a>
  ) : (
    <p className='text-slate10'>
      Provider supplied an unsupported authorization link.
    </p>
  )
}
