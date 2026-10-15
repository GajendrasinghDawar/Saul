import { randomUUID } from 'node:crypto'
import {
  type Api,
  type ApiKeyAuth,
  type AuthOperationOptions,
  type Credential,
  type CredentialStore,
  createProvider,
  envApiKeyAuth,
  type Model,
  type ProviderStreams,
} from '@earendil-works/pi-ai'
import { anthropicMessagesApi } from '@earendil-works/pi-ai/api/anthropic-messages.lazy'
import { azureOpenAIResponsesApi } from '@earendil-works/pi-ai/api/azure-openai-responses.lazy'
import { googleGenerativeAIApi } from '@earendil-works/pi-ai/api/google-generative-ai.lazy'
import { openAICompletionsApi } from '@earendil-works/pi-ai/api/openai-completions.lazy'
import { openAIResponsesApi } from '@earendil-works/pi-ai/api/openai-responses.lazy'
import { builtinModels } from '@earendil-works/pi-ai/providers/all'
import { eq } from 'drizzle-orm'
import { db } from '../db/index.ts'
import { secrets } from '../db/schema.ts'
import { decryptSetting, encryptSetting } from '../secretsManager.ts'

const credentialPrefix = 'ai:credential:'
const configName = 'ai:config:v1'
const apis: Record<string, ProviderStreams> = {
  'openai-completions': openAICompletionsApi(),
  'openai-responses': openAIResponsesApi(),
  'anthropic-messages': anthropicMessagesApi(),
  'google-generative-ai': googleGenerativeAIApi(),
  'azure-openai-responses': azureOpenAIResponsesApi(),
}
export type ModelRef = { provider: string; modelId: string }
type Custom = {
  id: string
  name: string
  baseUrl: string
  api: string
  keyless: boolean
  models: Model<Api>[]
}
type Config = {
  defaultModel: ModelRef | null
  providers: Custom[]
  deviceId: string
}

export class AiError extends Error {}
export class SerialQueue {
  private pending = Promise.resolve()
  run<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.pending.then(fn)
    this.pending = result.then(
      () => {},
      () => {}
    )
    return result
  }
  async wait() {
    await this.pending
  }
}
async function save(name: string, value: unknown) {
  const row = {
    name,
    value: encryptSetting(name, JSON.stringify(value)),
    kind: 'secret',
    updatedAt: new Date(),
  }
  await db
    .insert(secrets)
    .values(row)
    .onConflictDoUpdate({ target: secrets.name, set: row })
}
function decode(name: string, value: string): unknown {
  try {
    return JSON.parse(decryptSetting(name, value))
  } catch {
    throw new AiError(
      'Stored AI configuration cannot be unlocked. Check the encryption key and stored format.'
    )
  }
}
function credential(value: unknown): Credential {
  if (!value || typeof value !== 'object')
    throw new AiError('Stored AI credential is invalid.')
  const c = value as Credential
  if (
    c.type === 'api_key' &&
    (c.key === undefined || typeof c.key === 'string')
  )
    return c
  if (
    c.type === 'oauth' &&
    typeof c.access === 'string' &&
    typeof c.refresh === 'string' &&
    Number.isFinite(c.expires)
  )
    return c
  throw new AiError('Stored AI credential is invalid.')
}
export class EncryptedCredentialStore implements CredentialStore {
  private queues = new Map<string, SerialQueue>()
  private values = new Map<string, Credential>()
  private queue(id: string) {
    let queue = this.queues.get(id)
    if (!queue) {
      queue = new SerialQueue()
      this.queues.set(id, queue)
    }
    return queue
  }
  async load() {
    for (const row of await db.select().from(secrets)) {
      if (row.name.startsWith(credentialPrefix))
        this.values.set(
          row.name.slice(credentialPrefix.length),
          credential(decode(row.name, row.value))
        )
    }
  }
  async read(id: string, options?: AuthOperationOptions) {
    // Reads see the last committed snapshot while a refresh is pending.
    // Values change atomically only after the encrypted write succeeds.
    options?.signal?.throwIfAborted()
    const value = this.values.get(id)
    return value ? structuredClone(value) : undefined
  }
  async list(options?: AuthOperationOptions) {
    options?.signal?.throwIfAborted()
    return [...this.values].map(([providerId, c]) => ({
      providerId,
      type: c.type,
    }))
  }
  modify(
    id: string,
    fn: (current: Credential | undefined) => Promise<Credential | undefined>,
    options?: AuthOperationOptions
  ) {
    return this.queue(id).run(async () => {
      options?.signal?.throwIfAborted()
      const current = this.values.get(id)
      const next = await fn(current ? structuredClone(current) : undefined)
      options?.signal?.throwIfAborted()
      if (next) {
        credential(next)
        await save(credentialPrefix + id, next)
        this.values.set(id, structuredClone(next))
      }
      return structuredClone(this.values.get(id))
    })
  }
  delete(id: string, options?: AuthOperationOptions) {
    return this.queue(id).run(async () => {
      options?.signal?.throwIfAborted()
      await db.delete(secrets).where(eq(secrets.name, credentialPrefix + id))
      this.values.delete(id)
    })
  }
}
function text(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 256 &&
    !Array.from(value).some(
      c => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127
    )
  )
}
function modelObject<T extends object>(value: T | undefined): T | undefined {
  if (value === undefined) return undefined
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new AiError('Native model options must be JSON objects.')
  // Pi owns these schemas and their interpretation. Preserve its native
  // options rather than maintaining a second compatibility vocabulary.
  return structuredClone(value)
}
function validateCustom(id: string, value: unknown): Custom {
  if (
    !/^[a-zA-Z0-9._-]{1,100}$/.test(id) ||
    !value ||
    typeof value !== 'object'
  )
    throw new AiError('Invalid custom provider.')
  const v = value as Custom
  if (
    !text(v.name) ||
    typeof v.keyless !== 'boolean' ||
    typeof v.api !== 'string' ||
    !Object.hasOwn(apis, v.api)
  )
    throw new AiError('Invalid custom provider.')
  try {
    const url = new URL(v.baseUrl)
    if (
      !(
        url.protocol === 'https:' ||
        (url.protocol === 'http:' &&
          ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
      ) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      throw new Error()
  } catch {
    throw new AiError(
      'Use HTTPS or a local HTTP endpoint without credentials, query or fragment.'
    )
  }
  if (!Array.isArray(v.models) || !v.models.length || v.models.length > 200)
    throw new AiError('Invalid model catalog.')
  const ids = new Set<string>()
  const models = v.models.map(m => {
    if (
      !m ||
      !text(m.id) ||
      !text(m.name) ||
      ids.has(m.id) ||
      typeof m.reasoning !== 'boolean' ||
      !Array.isArray(m.input) ||
      !m.input.length ||
      m.input.some(i => i !== 'text' && i !== 'image') ||
      !Number.isSafeInteger(m.contextWindow) ||
      m.contextWindow <= 0 ||
      !Number.isSafeInteger(m.maxTokens) ||
      m.maxTokens <= 0 ||
      m.maxTokens > m.contextWindow ||
      !m.cost ||
      [m.cost.input, m.cost.output, m.cost.cacheRead, m.cost.cacheWrite].some(
        v => typeof v !== 'number' || !Number.isFinite(v) || v < 0
      )
    )
      throw new AiError('Invalid native model fields.')
    ids.add(m.id)
    // Whitelist native non-secret fields; never publish arbitrary headers.
    return {
      id: m.id,
      name: m.name,
      provider: id,
      api: v.api,
      baseUrl: v.baseUrl,
      input: m.input,
      reasoning: m.reasoning,
      cost: {
        ...m.cost,
      },
      contextWindow: m.contextWindow,
      maxTokens: m.maxTokens,
      compat: modelObject(m.compat),
      thinkingLevelMap: modelObject(m.thinkingLevelMap),
      inputLimits: modelObject(m.inputLimits),
      promptCache: modelObject(m.promptCache),
      samplingParams: modelObject(m.samplingParams),
    } as Model<Api>
  })
  return {
    id,
    name: v.name,
    baseUrl: v.baseUrl,
    api: v.api,
    keyless: v.keyless,
    models,
  }
}
function provider(c: Custom) {
  const apiKey: ApiKeyAuth = c.keyless
    ? {
        name: 'No key required',
        resolve: async () => ({
          auth: { apiKey: 'local-keyless' },
          source: 'Keyless',
        }),
      }
    : envApiKeyAuth(`${c.name} API key`, [])
  return createProvider({
    ...c,
    api: apis[c.api],
    auth: {
      apiKey: {
        ...apiKey,
        resolve: async input => {
          const resolved = await apiKey.resolve(input)
          return resolved && c.api === 'azure-openai-responses'
            ? {
                ...resolved,
                env: { ...resolved.env, AZURE_OPENAI_BASE_URL: c.baseUrl },
              }
            : resolved
        },
      },
    },
  })
}
export class AiManager {
  readonly credentials = new EncryptedCredentialStore()
  readonly models = builtinModels({ credentials: this.credentials })
  private builtins = new Set(this.models.getProviders().map(p => p.id))
  private queue = new SerialQueue()
  private config: Config = {
    defaultModel: null,
    providers: [],
    deviceId: randomUUID(),
  }
  getDefault = () =>
    this.config.defaultModel ? { ...this.config.defaultModel } : null
  getDeviceId = () => this.config.deviceId
  newConversationModel = () =>
    this.queue.run(async () => {
      const ref = this.getDefault()
      if (
        !ref ||
        !this.models.getModel(ref.provider, ref.modelId) ||
        !(await this.models.checkAuth(ref.provider))
      )
        throw new AiError(
          'No configured default AI model is available. Ask an administrator to configure one.'
        )
      return ref
    })
  async load() {
    await this.credentials.load()
    const rows = await db
      .select()
      .from(secrets)
      .where(eq(secrets.name, configName))
    if (rows[0]) {
      try {
        const c = decode(configName, rows[0].value) as Config
        if (
          !Array.isArray(c.providers) ||
          !text(c.deviceId) ||
          (c.defaultModel !== null &&
            (!text(c.defaultModel.provider) || !text(c.defaultModel.modelId)))
        )
          throw new Error()
        c.providers = c.providers.map(p => {
          if (this.builtins.has(p.id)) throw new Error()
          return validateCustom(p.id, p)
        })
        this.config = c
      } catch {
        throw new AiError(
          'Stored AI configuration is invalid or cannot be unlocked.'
        )
      }
    }
    for (const c of this.config.providers) this.models.setProvider(provider(c))
    const azureModel = process.env.AZURE_OPENAI_MODEL
    if (azureModel) {
      const p = this.models.getProvider('azure-openai-responses')
      if (p && !this.models.getModel(p.id, azureModel)) {
        const m: Model<Api> = {
          id: azureModel,
          name: azureModel,
          provider: p.id,
          api: 'azure-openai-responses',
          baseUrl: process.env.AZURE_OPENAI_BASE_URL ?? '',
          input:
            process.env.AZURE_OPENAI_INPUT === 'text,image'
              ? ['text', 'image']
              : ['text'],
          reasoning: false,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          contextWindow: 128000,
          maxTokens: 4096,
        }
        this.models.setProvider({
          ...p,
          getModels: () => [...p.getModels(), m],
        })
      }
    }
    if (!rows[0]) {
      const providerId =
        process.env.SAUL_AI_PROVIDER ??
        (azureModel ? 'azure-openai-responses' : undefined)
      const modelId = process.env.SAUL_AI_MODEL ?? azureModel
      if (providerId && modelId)
        await this.setDefault({ provider: providerId, modelId })
      else if (process.env.SAUL_SECRETS_KEY) await save(configName, this.config)
    }
  }
  async metadata() {
    return this.queue.run(async () => {
      const providers = await Promise.all(
        this.models.getProviders().map(async p => {
          const check = await this.models.checkAuth(p.id)
          const c = this.config.providers.find(c => c.id === p.id)
          return {
            id: p.id,
            name: p.name,
            custom: Boolean(c),
            authMethods: [
              ...(p.auth.apiKey?.login
                ? [{ type: 'api_key', label: p.auth.apiKey.name }]
                : []),
              ...(p.auth.oauth
                ? [
                    {
                      type: 'oauth',
                      label: p.auth.oauth.loginLabel ?? p.auth.oauth.name,
                    },
                  ]
                : []),
            ],
            auth: { configured: Boolean(check), ...check },
            ...(c
              ? { baseUrl: c.baseUrl, api: c.api, keyless: c.keyless }
              : {}),
          }
        })
      )
      return {
        defaultModel: this.getDefault(),
        providers,
        customApis: Object.keys(apis).map(id => ({ id, label: id })),
      }
    })
  }
  ensureConfig() {
    return this.queue.run(() => save(configName, this.config))
  }
  async catalog(id: string) {
    await this.queue.wait()
    if (!this.models.getProvider(id)) throw new AiError('Provider not found.')
    return this.models
      .getModels(id)
      .map(({ headers: _headers, ...model }) => model)
  }
  setDefault(ref: ModelRef) {
    return this.queue.run(async () => {
      if (
        !ref ||
        !text(ref.provider) ||
        !text(ref.modelId) ||
        !this.models.getModel(ref.provider, ref.modelId)
      )
        throw new AiError('Choose a registered model.')
      if (!(await this.models.checkAuth(ref.provider)))
        throw new AiError('Configure provider authentication first.')
      const next = {
        ...this.config,
        defaultModel: { provider: ref.provider, modelId: ref.modelId },
      }
      await save(configName, next)
      this.config = next
    })
  }
  put(id: string, value: unknown) {
    return this.queue.run(async () => {
      if (this.builtins.has(id))
        throw new AiError('Built-in providers cannot be replaced.')
      const c = validateCustom(id, value)
      const p = provider(c)
      if (
        this.config.defaultModel?.provider === id &&
        !c.models.some(m => m.id === this.config.defaultModel?.modelId)
      )
        throw new AiError('The active default model cannot be removed.')
      const next = {
        ...this.config,
        providers: [...this.config.providers.filter(p => p.id !== id), c],
      }
      const previous = this.config.providers.find(p => p.id === id)
      if (
        previous &&
        (previous.baseUrl !== c.baseUrl || previous.api !== c.api)
      )
        await this.credentials.delete(id)
      await save(configName, next)
      this.models.setProvider(p)
      this.config = next
    })
  }
  remove(id: string) {
    return this.queue.run(async () => {
      if (
        this.builtins.has(id) ||
        !this.config.providers.some(p => p.id === id)
      )
        throw new AiError('Only custom providers can be deleted.')
      if (this.config.defaultModel?.provider === id)
        throw new AiError(
          'Choose another default before deleting this provider.'
        )
      const next = {
        ...this.config,
        providers: this.config.providers.filter(p => p.id !== id),
      }
      await this.models.logout(id)
      await save(configName, next)
      this.models.deleteProvider(id)
      this.config = next
    })
  }
}
