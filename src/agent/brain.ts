import { createOpenAI } from "@ai-sdk/openai";
import { generateObject } from 'ai';
import { z } from 'zod';
import { ACTIONS, type ActionName } from './types.ts';
import dotenv from "dotenv";
dotenv.config({ override: true });

const aiProvider = createOpenAI({
  baseURL: process.env.AZURE_OPENAI_BASE_URL,
  apiKey: process.env.AZURE_OPENAI_API_KEY,
});

function model() {
  const id = process.env.AZURE_OPENAI_MODEL || process.env.OPENAI_MODEL;
  if (!id) throw new Error('Set AZURE_OPENAI_MODEL in .env');
  return aiProvider.chat(id);
}

const decisionSchema = z.object({
  action: z.enum(ACTIONS),
  reason: z.string(),
  detail: z.string().optional(),
});

type Decision = { action: ActionName; reason: string; detail?: string };

export async function chooseAction(state: any): Promise<Decision> {
  const isMessage = !!state.incomingMessage;
  
  const systemPrompt = isMessage 
    ? `You are Lali, an autonomous personal assistant.
A user just sent you a message. You must process it and choose exactly one action:
- If they are giving you a task, reminder, or thing to do, use 'save_todo' and put the exact task text in the 'detail' field.
- If they are just chatting or asking a general question, use 'reply_to_user' and put your friendly response in the 'detail' field.
- If you're done, use 'complete'.
Keep your reason short.`
    : `You are an autonomous Daily Digest Assistant.
Choose exactly one action.
Available actions: read_todos, send_digest_email, clear_todos, complete, wait.
If you haven't read the todos yet, use read_todos.
If you read the todos and there are pending items, use send_digest_email and put the formatted email body in the 'detail' field.
If the email was sent, use complete.
Keep your reason short.`;

  const result = await generateObject({
    model: model(),
    schema: decisionSchema,
    system: systemPrompt,
    prompt: `Current observed state:\n${JSON.stringify(state, null, 2)}`,
  });
  return result.object;
}
