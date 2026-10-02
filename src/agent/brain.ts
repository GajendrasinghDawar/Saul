import { Type, type Model } from "@earendil-works/pi-ai";
import { builtinModels } from "@earendil-works/pi-ai/providers/all";
import { ACTIONS, type ActionName } from './types.ts';
import dotenv from "dotenv";
dotenv.config({ override: true });

const models = builtinModels();

function getModel(): Model<any> {
  const id = process.env.AZURE_OPENAI_MODEL || process.env.OPENAI_MODEL;
  if (!id) throw new Error('Set AZURE_OPENAI_MODEL in .env');
  
  const isAzure = !!process.env.AZURE_OPENAI_MODEL;
  const providerName = isAzure ? "azure-openai-responses" : "openai-responses";
  
  let model: Model<any> | undefined = models.getModel(providerName, id);
  if (!model) {
    model = {
      id,
      name: "Custom Model",
      api: providerName as any,
      provider: providerName as any,
      baseUrl: isAzure ? (process.env.AZURE_OPENAI_BASE_URL || "") : "",
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 128000,
      maxTokens: 4096,
      reasoning: false
    };
  }
  return model;
}

const decisionSchema = Type.Object({
  action: Type.Union(ACTIONS.map(a => Type.Literal(a))),
  reason: Type.String(),
  detail: Type.String({ description: "Additional detail for the action, or an empty string if none is needed." }),
});

type Decision = { action: ActionName; reason: string; detail: string };

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

  const result = await models.completeSimple(
    getModel(),
    {
      systemPrompt: systemPrompt + "\nCall the choose_action tool.",
      messages: [{ role: "user", content: `Current observed state:\n${JSON.stringify(state, null, 2)}`, timestamp: Date.now() }],
      tools: [{
        name: "choose_action",
        description: "Chooses the next action to take",
        parameters: decisionSchema
      }]
    }
  );
  
  const toolCall = result.content.find(c => c.type === "toolCall" && c.name === "choose_action");
  if (!toolCall || toolCall.type !== "toolCall") {
    throw new Error("Model failed to call choose_action tool.");
  }
  
  return toolCall.arguments as Decision;
}
