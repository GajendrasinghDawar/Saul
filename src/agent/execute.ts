import { recordToolAction } from "./data.ts";
import { toolRegistry } from "./tools.ts";

export async function executeAction(runId: string, action: string, detail: string = ""): Promise<void> {
  try {
    // 1. Look up the tool in our modular registry
    const executeTool = toolRegistry[action];
    
    // 2. If the tool doesn't exist, throw an error
    if (!executeTool) {
      throw new Error(`Unknown action: ${action}`);
    }
    
    // 3. Execute the tool!
    await executeTool(runId, detail);

  } catch (error: any) {
    // Lesson 2 pattern: log failures durably so the agent knows the tool crashed
    await recordToolAction(runId, action, `FAILED: ${error.message}`);
    throw error;
  }
}
