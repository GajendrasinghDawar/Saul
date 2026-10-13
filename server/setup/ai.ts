import type { Model } from '@earendil-works/pi-ai'
import { builtinModels } from '@earendil-works/pi-ai/providers/all'
import { getSecret, markSettingActive } from '../secretsManager.ts'

export function setupAiModel() {
  const models = builtinModels({
    authContext: {
      env: async name => getSecret(name) || undefined,
      fileExists: async () => false,
    },
  })
  const providerName = 'azure-openai-responses'
  const modelId = getSecret('AZURE_OPENAI_MODEL') || 'gpt-6-luna'
  const baseUrl = getSecret('AZURE_OPENAI_BASE_URL')
  const provider = models.getProvider(providerName)
  if (!provider) throw new Error('Azure OpenAI provider is unavailable')
  const apiKeyAuth = provider.auth.apiKey
  if (!apiKeyAuth) throw new Error('Azure OpenAI authentication is unavailable')
  const existing = models.getModel(providerName, modelId)
  const configuredInput = getSecret('AZURE_OPENAI_INPUT')
  const model: Model<'azure-openai-responses'> = {
    id: modelId,
    name: existing?.name ?? 'Azure Custom Model',
    api: 'azure-openai-responses',
    provider: providerName,
    baseUrl: baseUrl || existing?.baseUrl || '',
    input:
      configuredInput === 'text,image'
        ? ['text', 'image']
        : configuredInput === 'text'
          ? ['text']
          : (existing?.input ?? ['text']),
    cost: existing?.cost ?? {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
    },
    contextWindow: existing?.contextWindow ?? 128000,
    maxTokens: existing?.maxTokens ?? 4096,
    reasoning: existing?.reasoning ?? false,
  }
  const catalog = [
    ...provider.getModels().filter(item => item.id !== modelId),
    model,
  ]
  models.setProvider({
    ...provider,
    getModels: () => catalog,
    getAllModels: () => catalog,
    auth: {
      apiKey: {
        ...apiKeyAuth,
        resolve: async input => {
          const resolved = await apiKeyAuth.resolve(input)
          return resolved
            ? {
                ...resolved,
                env: { ...resolved.env, AZURE_OPENAI_BASE_URL: baseUrl },
              }
            : undefined
        },
      },
    },
  })
  markSettingActive('AZURE_OPENAI_MODEL', modelId)
  markSettingActive('AZURE_OPENAI_BASE_URL', baseUrl)
  markSettingActive('AZURE_OPENAI_INPUT', configuredInput)
  return { models, providerName, modelId }
}
