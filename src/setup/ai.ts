import { builtinModels } from '@earendil-works/pi-ai/providers/all'

export function setupAiModel() {
  const models = builtinModels()
  const providerName = 'azure-openai-responses'
  const modelId = process.env.AZURE_OPENAI_MODEL || 'gpt-6-luna'

  if (!models.getModel(providerName, modelId)) {
    // @ts-expect-error (pi-ai might not list this exact custom model id statically)
    models.addModel({
      id: modelId,
      name: 'Azure Custom Model',
      api: providerName as 'azure-openai-responses',
      provider: 'azure-openai',
      baseUrl: process.env.AZURE_OPENAI_BASE_URL || '',
      input: ['text'],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 128000,
      maxTokens: 4096,
      reasoning: false,
    })
  }

  return { models, providerName, modelId }
}
