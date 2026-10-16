import { useState } from 'react'
import type {
  AzureConnection as Connection,
  Model,
} from '../../lib/ai-settings'

const input =
  'mt-1 w-full min-w-0 rounded-md border border-slate6 bg-slate1 px-3 py-2 text-sm text-slate12'
const button =
  'rounded-md border border-slate6 px-3 py-2 text-sm text-slate11 hover:bg-slate3 disabled:opacity-50'

export function AzureConnection({
  connection,
  models,
  busy,
  onSave,
}: {
  connection?: Connection | null
  models: Model[]
  busy: boolean
  onSave: (connection: Connection) => void
}) {
  const [baseUrl, setBaseUrl] = useState(connection?.baseUrl ?? '')
  const [apiVersion, setApiVersion] = useState(connection?.apiVersion ?? 'v1')
  const [rows, setRows] = useState(() => {
    const entries = Object.entries(connection?.deployments ?? {})
    return (entries.length ? entries : [['', '']]).map(([modelId, name]) => ({
      key: crypto.randomUUID(),
      modelId,
      name,
    }))
  })
  const [error, setError] = useState('')
  return (
    <form
      className='mt-4 space-y-3 rounded-lg border border-slate6 bg-slate2 p-4'
      onSubmit={event => {
        event.preventDefault()
        if (new Set(rows.map(row => row.modelId)).size !== rows.length) {
          setError('Each model can have only one deployment.')
          return
        }
        setError('')
        onSave({
          baseUrl: baseUrl.trim(),
          apiVersion: apiVersion.trim(),
          deployments: Object.fromEntries(
            rows.map(row => [row.modelId, row.name.trim()])
          ),
        })
      }}
    >
      <h4 className='text-sm font-medium text-slate12'>Azure connection</h4>
      <p className='text-xs text-slate10'>
        Set the resource endpoint and match each model to its deployment name in
        Azure. No .env changes are required.
      </p>
      <label className='block text-sm text-slate11'>
        Resource endpoint
        <input
          aria-label='Azure resource endpoint'
          type='url'
          required
          className={input}
          placeholder='https://your-resource.openai.azure.com/openai/v1'
          value={baseUrl}
          onChange={event => setBaseUrl(event.target.value)}
          disabled={busy}
        />
      </label>
      <label className='block text-sm text-slate11'>
        API version
        <input
          required
          className={input}
          value={apiVersion}
          onChange={event => setApiVersion(event.target.value)}
          disabled={busy}
        />
      </label>
      {rows.map(row => (
        <div
          key={row.key}
          className='space-y-2 rounded-md border border-slate5 p-3'
        >
          <label className='block text-sm text-slate11'>
            Model
            <select
              required
              className={input}
              value={row.modelId}
              disabled={busy}
              onChange={event =>
                setRows(current =>
                  current.map(r =>
                    r.key === row.key
                      ? { ...r, modelId: event.target.value }
                      : r
                  )
                )
              }
            >
              <option value=''>Choose the model deployed in Azure</option>
              {models.map(model => (
                <option key={model.id} value={model.id}>
                  {model.name} ({model.id})
                </option>
              ))}
            </select>
          </label>
          <label className='block text-sm text-slate11'>
            Azure deployment name
            <input
              required
              className={input}
              placeholder='e.g. saul-gpt-4-1'
              value={row.name}
              disabled={busy}
              onChange={event =>
                setRows(current =>
                  current.map(r =>
                    r.key === row.key ? { ...r, name: event.target.value } : r
                  )
                )
              }
            />
          </label>
          {rows.length > 1 && (
            <button
              type='button'
              className={button}
              disabled={busy}
              onClick={() =>
                setRows(current => current.filter(r => r.key !== row.key))
              }
            >
              Remove deployment
            </button>
          )}
        </div>
      ))}
      {error && (
        <p role='alert' className='text-sm text-crimson11'>
          {error}
        </p>
      )}
      <p className='text-xs text-slate10'>
        Changing an existing endpoint clears its stored key. Re-enter the key
        after saving. Environment credentials, if set, remain available.
      </p>
      <div className='flex flex-wrap gap-2'>
        <button
          type='button'
          className={button}
          disabled={busy || !models.length}
          onClick={() =>
            setRows(current => [
              ...current,
              { key: crypto.randomUUID(), modelId: '', name: '' },
            ])
          }
        >
          Add deployment
        </button>
        <button
          type='submit'
          className='rounded-md border border-slate8 bg-slate12 px-3 py-2 text-sm text-slate1 hover:bg-slate11 disabled:opacity-50'
          disabled={busy || !models.length}
        >
          Save Azure connection
        </button>
      </div>
    </form>
  )
}
