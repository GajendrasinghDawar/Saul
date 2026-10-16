import { Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { type Model, type Provider, safeUrl } from '../../lib/ai-settings'

type Connection = {
  name: string
  baseUrl: string
  api: string
  keyless: boolean
  models: Model[]
}
const input =
  'mt-1 w-full min-w-0 rounded-md border border-slate6 bg-slate1 px-3 py-2 text-sm text-slate12'
const button =
  'rounded-md border border-slate6 px-3 py-2 text-sm text-slate11 hover:bg-slate3 disabled:opacity-50'
const optionNames = [
  'compat',
  'thinkingLevelMap',
  'inputLimits',
  'promptCache',
  'samplingParams',
]
function emptyModel(): Model {
  return {
    id: '',
    name: '',
    provider: '',
    api: '',
    baseUrl: '',
    input: ['text'],
    reasoning: false,
    contextWindow: 128000,
    maxTokens: 8192,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  }
}

export function CustomConnection({
  provider,
  models: catalog,
  apis,
  busy,
  onCancel,
  onSave,
}: {
  provider?: Provider
  models: Model[]
  apis: { id: string; label: string }[]
  busy: boolean
  onCancel: () => void
  onSave: (id: string, connection: Connection) => void
}) {
  const [id, setId] = useState(provider?.id ?? '')
  const [name, setName] = useState(provider?.name ?? '')
  const [baseUrl, setBaseUrl] = useState(provider?.baseUrl ?? '')
  const [api, setApi] = useState(provider?.api ?? apis[0]?.id ?? '')
  const [keyless, setKeyless] = useState(provider?.keyless ?? false)
  const [models, setModels] = useState(
    catalog.length ? catalog : [emptyModel()]
  )
  const [modelKeys, setModelKeys] = useState(() =>
    (catalog.length ? catalog : [emptyModel()]).map(() => crypto.randomUUID())
  )
  const [nativeOptions, setNativeOptions] = useState(() =>
    (catalog.length ? catalog : [emptyModel()]).map(model =>
      JSON.stringify(
        Object.fromEntries(
          optionNames
            .filter(key => model[key] !== undefined)
            .map(key => [key, model[key]])
        ),
        null,
        2
      )
    )
  )
  const [error, setError] = useState('')
  const update = (index: number, patch: Partial<Model>) =>
    setModels(current =>
      current.map((model, i) => (i === index ? { ...model, ...patch } : model))
    )
  return (
    <form
      className='min-w-0 space-y-4 rounded-lg border border-slate5 bg-slate2 p-4'
      onSubmit={event => {
        event.preventDefault()
        setError('')
        const endpoint = safeUrl(baseUrl)
        const url = endpoint ? new URL(endpoint) : null
        if (
          !url ||
          url.search ||
          url.hash ||
          (url.protocol === 'http:' &&
            !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
        ) {
          setError(
            'Use HTTPS or local HTTP without credentials, query or fragment.'
          )
          return
        }
        if (!apis.some(item => item.id === api)) {
          setError('Choose a supported Pi API family.')
          return
        }
        if (
          !models.length ||
          new Set(models.map(model => model.id.trim())).size !== models.length
        ) {
          setError('Add at least one model with unique model IDs.')
          return
        }
        let options: Record<string, unknown>[]
        try {
          options = nativeOptions.map(value => {
            const parsed: unknown = JSON.parse(value)
            if (
              !parsed ||
              typeof parsed !== 'object' ||
              Array.isArray(parsed) ||
              Object.keys(parsed).some(key => !optionNames.includes(key))
            )
              throw new Error()
            return parsed as Record<string, unknown>
          })
        } catch {
          setError(
            'Native options must be a JSON object containing only the listed Pi model fields.'
          )
          return
        }
        onSave(id.trim(), {
          name: name.trim(),
          baseUrl: baseUrl.trim(),
          api,
          keyless,
          models: models.map((model, index) => ({
            ...model,
            ...Object.fromEntries(
              optionNames.map(key => [key, options[index][key]])
            ),
            id: model.id.trim(),
            name: model.name.trim(),
            provider: id.trim(),
            baseUrl: baseUrl.trim(),
            api,
          })),
        })
      }}
    >
      <h3 className='font-medium text-slate12'>
        {provider ? 'Edit custom connection' : 'Add custom connection'}
      </h3>
      <p className='text-sm text-slate10'>
        Choose the native Pi API family your endpoint implements. API keys are
        configured separately after saving. Arbitrary headers are not stored
        here. Changing the endpoint or API family clears stored credentials;
        sign in again for the new connection.
      </p>
      {error && (
        <p role='alert' className='text-sm text-crimson11'>
          {error}
        </p>
      )}
      <fieldset disabled={busy} className='min-w-0 space-y-4'>
        <div className='grid min-w-0 gap-3 sm:grid-cols-2'>
          <label className='min-w-0 text-sm text-slate11'>
            Connection ID
            <input
              className={input}
              required
              pattern='[a-zA-Z0-9._-]{1,100}'
              disabled={!!provider}
              value={id}
              onChange={e => setId(e.target.value)}
              placeholder='my-provider'
            />
          </label>
          <label className='min-w-0 text-sm text-slate11'>
            Display name
            <input
              className={input}
              required
              value={name}
              onChange={e => setName(e.target.value)}
            />
          </label>
        </div>
        <label className='block text-sm text-slate11'>
          Base URL
          <input
            className={input}
            type='url'
            required
            value={baseUrl}
            onChange={e => setBaseUrl(e.target.value)}
            placeholder='https://endpoint.example/v1'
          />
        </label>
        <label className='block text-sm text-slate11'>
          Pi API family
          <select
            className={input}
            required
            value={api}
            onChange={e => setApi(e.target.value)}
          >
            <option value=''>Choose API family</option>
            {apis.map(item => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        <label className='flex items-center gap-2 text-sm text-slate11'>
          <input
            type='checkbox'
            checked={keyless}
            onChange={e => setKeyless(e.target.checked)}
          />
          This endpoint does not require a key
        </label>
        <div className='space-y-3'>
          <h4 className='text-sm font-medium text-slate12'>Models</h4>
          <p className='text-xs text-slate10'>
            Costs default to zero for new models. Existing native capabilities
            and costs are preserved when editing.
          </p>
          {models.map((model, index) => (
            <div
              key={modelKeys[index]}
              className='min-w-0 space-y-3 rounded-md border border-slate5 p-3'
            >
              <div className='flex items-center justify-between gap-2'>
                <h5 className='text-sm text-slate11'>Model {index + 1}</h5>
                <button
                  type='button'
                  className={button}
                  aria-label={`Remove model ${index + 1}`}
                  onClick={() => {
                    setModels(current => current.filter((_, i) => i !== index))
                    setNativeOptions(current =>
                      current.filter((_, i) => i !== index)
                    )
                    setModelKeys(current =>
                      current.filter((_, i) => i !== index)
                    )
                  }}
                >
                  <Trash2 size={14} />
                </button>
              </div>
              <div className='grid min-w-0 gap-3 sm:grid-cols-2'>
                <label className='min-w-0 text-sm text-slate11'>
                  Model ID
                  <input
                    required
                    className={input}
                    value={model.id}
                    onChange={e => update(index, { id: e.target.value })}
                  />
                </label>
                <label className='min-w-0 text-sm text-slate11'>
                  Model name
                  <input
                    required
                    className={input}
                    value={model.name}
                    onChange={e => update(index, { name: e.target.value })}
                  />
                </label>
                <label className='min-w-0 text-sm text-slate11'>
                  Context window
                  <input
                    required
                    type='number'
                    min={1}
                    step={1}
                    className={input}
                    value={model.contextWindow}
                    onChange={e =>
                      update(index, { contextWindow: Number(e.target.value) })
                    }
                  />
                </label>
                <label className='min-w-0 text-sm text-slate11'>
                  Max output tokens
                  <input
                    required
                    type='number'
                    min={1}
                    step={1}
                    className={input}
                    value={model.maxTokens}
                    onChange={e =>
                      update(index, { maxTokens: Number(e.target.value) })
                    }
                  />
                </label>
              </div>
              <div className='flex flex-wrap gap-4 text-sm text-slate11'>
                <span>Text input</span>
                <label className='flex items-center gap-2'>
                  <input
                    type='checkbox'
                    checked={model.input.includes('image')}
                    onChange={e =>
                      update(index, {
                        input: e.target.checked ? ['text', 'image'] : ['text'],
                      })
                    }
                  />
                  Image input
                </label>
                <label className='flex items-center gap-2'>
                  <input
                    type='checkbox'
                    checked={model.reasoning}
                    onChange={e =>
                      update(index, { reasoning: e.target.checked })
                    }
                  />
                  Reasoning
                </label>
              </div>
              <details>
                <summary className='cursor-pointer text-sm text-slate10'>
                  Native Pi options
                </summary>
                <label className='mt-2 block text-xs text-slate10'>
                  JSON for compat, thinkingLevelMap, inputLimits, promptCache,
                  and samplingParams. Pi interprets these fields; omit them to
                  use its defaults.
                  <textarea
                    aria-label={`Native Pi options for model ${index + 1}`}
                    className={`${input} min-h-32 font-mono text-xs`}
                    spellCheck={false}
                    value={nativeOptions[index]}
                    onChange={e =>
                      setNativeOptions(current =>
                        current.map((value, i) =>
                          i === index ? e.target.value : value
                        )
                      )
                    }
                  />
                </label>
              </details>
            </div>
          ))}
          <button
            type='button'
            className={`${button} flex items-center gap-2`}
            onClick={() => {
              setModels(current => [...current, emptyModel()])
              setNativeOptions(current => [...current, '{}'])
              setModelKeys(current => [...current, crypto.randomUUID()])
            }}
          >
            <Plus size={14} />
            Add model
          </button>
        </div>
      </fieldset>
      <div className='flex flex-wrap justify-end gap-2'>
        <button
          type='button'
          className={button}
          disabled={busy}
          onClick={onCancel}
        >
          Cancel
        </button>
        <button
          type='submit'
          className='rounded-md border border-slate8 bg-slate12 px-3 py-2 text-sm text-slate1 hover:bg-slate11 disabled:opacity-50'
          disabled={busy || !apis.length}
        >
          {busy ? 'Saving…' : 'Save connection'}
        </button>
      </div>
    </form>
  )
}
