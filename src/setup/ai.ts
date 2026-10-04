import { builtinModels } from '@earendil-works/pi-ai/providers/all'

export function setupAiModel() {
  const models = builtinModels()
  const isAzure = !!process.env.AZURE_OPENAI_MODEL
  const providerName = isAzure ? 'azure-openai-responses' : 'openai-responses'
  const modelId =
    process.env.AZURE_OPENAI_MODEL || process.env.OPENAI_MODEL || 'gpt-4'

  if (!models.getModel(providerName, modelId)) {
    // @ts-expect-error
    models.addModel({
      id: modelId,
      name: 'Custom Model',
      api: providerName as 'azure-openai-responses' | 'openai-responses',
      provider: isAzure ? 'azure-openai' : 'openai',
      baseUrl: isAzure ? process.env.AZURE_OPENAI_BASE_URL || '' : '',
      input: ['text'],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 128000,
      maxTokens: 4096,
      reasoning: false,
    })
  }

  return { models, providerName, modelId }
}
