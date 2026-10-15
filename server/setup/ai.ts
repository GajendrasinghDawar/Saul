import { AiManager } from '../services/ai.ts'

export async function setupAiModel() {
  const ai = new AiManager()
  await ai.load()
  return ai
}
