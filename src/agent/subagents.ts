import {
  type ConversationId,
  type EntryId,
  type TaskId,
  defineDoc,
  defineTask,
  defineTool,
  defineExtension,
  AssistantEntry,
  LiveDoc,
  configure,
} from "@earendil-works/pi-durable";
import { type AssistantMessage, Type } from "@earendil-works/pi-ai";

type Subagent = {
  conversationId: ConversationId;
  reported: EntryId[];
};

export const Subagents = defineDoc<{
  agents: Record<string, Subagent>;
  reporters: Record<string, TaskId>;
}>({
  kind: "lali.subagents",
  version: 1,
  scope: "conversation",
  history: "latest",
  fork: "initial",
  initial: () => ({ agents: {}, reporters: {} }),
});

export const Anchor = defineTask<null, { phase: "done" }, null>({
  name: "lali.subagent-anchor",
  version: 1,
  initial: () => ({ phase: "done" }),
  phases: {
    done: (_anchor, runtime, taskContext) =>
      runtime.commit(
        () => ({
          status: "terminal",
          outcome: { status: "completed", result: null },
        }),
        taskContext,
      ),
  },
  abort: (_anchor, runtime, taskContext) =>
    runtime.commit(
      () => ({ status: "terminal", outcome: { status: "aborted" } }),
      taskContext,
    ),
});

type ReporterInput = {
  name: string;
  conversationId: ConversationId;
  message: string;
  followUp: boolean;
};
type ReporterState =
  | { phase: "deliver" }
  | { phase: "report"; report?: string };
export const Reporter = defineTask<ReporterInput, ReporterState, null>({
  name: "lali.subagent-reporter",
  version: 1,
  initial: () => ({ phase: "deliver" }),
  phases: {
    deliver: async (reporter, runtime, taskContext) => {
      const { name, conversationId, message, followUp } = reporter.input;
      const subagent = (await runtime.conversation(
        conversationId,
        taskContext,
      ))!;
      const request = {
        type: "input",
        content: message,
        whenBusy: followUp ? "followUp" : "steer",
      } as const;
      const submission = await subagent.submit(
        { ...request, requestId: `subagent:${reporter.id}` },
        taskContext,
      );
      const settled = await submission.wait(taskContext);
      await runtime.commit(async (tx) => {
        const next = (report?: string) =>
          ({
            status: "running",
            checkpoint: { phase: "report", report },
          }) as const;
        if (settled.status === "unanswered") {
          return next(
            settled.reason === "aborted"
              ? undefined
              : `[subagent ${name} failed: ${settled.reason}]`,
          );
        }
        if (settled.type !== "input") return next();
        const agent = (await tx.doc(Subagents, runtime.conversationId)).agents[
          name
        ]!;
        if (agent.reported.includes(settled.answer)) return next();
        agent.reported.push(settled.answer);
        const answer = (await tx.entry(AssistantEntry, settled.answer))
          ?.model?.[0] as AssistantMessage;
        return next(
          `[subagent ${name} answered, no reply needed] ${textOf(answer)}`,
        );
      }, taskContext);
    },
    report: async (reporter, runtime, taskContext) => {
      const report = reporter.state.checkpoint.report;
      if (report !== undefined) {
        const main = (await runtime.conversation(
          runtime.conversationId,
          taskContext,
        ))!;
        const input = {
          type: "input",
          content: report,
          whenBusy: "followUp",
        } as const;
        await main.submit(
          { ...input, requestId: `subagent-report:${reporter.id}` },
          taskContext,
        );
      }
      await runtime.commit(
        () => ({
          status: "terminal",
          outcome: { status: "completed", result: null },
        }),
        taskContext,
      );
    },
  },
  abort: (_reporter, runtime, taskContext) =>
    runtime.commit(
      () => ({ status: "terminal", outcome: { status: "aborted" } }),
      taskContext,
    ),
});

function textOf(message: AssistantMessage | undefined): string {
  return (message?.content ?? [])
    .flatMap((c) => (c.type === "text" ? [c.text] : []))
    .join("");
}

export const SubagentManager = {
  async getStatus(api: any, callContext: any, name?: string) {
    const registry = (await api.snapshot(
      Subagents,
      api.conversationId,
      callContext,
    )) ?? { agents: {}, reporters: {} };
    const names = name === undefined ? Object.keys(registry.agents) : [name];
    const statuses = [];
    for (const each of names) {
      const found = Object.hasOwn(registry.agents, each)
        ? registry.agents[each]
        : undefined;
      if (found === undefined) continue;
      const busy =
        (await api.snapshot(LiveDoc, found.conversationId, callContext))
          ?.run !== undefined;
      statuses.push({ name: each, state: busy ? "working" : "idle" });
    }
    return statuses;
  },

  async stop(api: any, callContext: any, name: string) {
    const registry = (await api.snapshot(
      Subagents,
      api.conversationId,
      callContext,
    )) ?? { agents: {} };
    const agent = registry.agents[name];
    if (!agent) return { error: `No subagent named ${name}.` };

    await (await api.conversation(agent.conversationId, callContext))!.abort(
      callContext,
    );
    return { success: true, conversationId: agent.conversationId };
  },

  async spawn(api: any, callContext: any, name: string, message: string) {
    const registry = (await api.snapshot(
      Subagents,
      api.conversationId,
      callContext,
    )) ?? { agents: {} };
    if (Object.hasOwn(registry.agents, name))
      return { error: `${name} already exists; use send.` };

    await api.commit(async (tx: any) => {
      const state = await tx.doc(Subagents, api.conversationId);
      const background = {
        ownership: { kind: "conversation" as const },
        background: true,
      } as const;

      const anchor = await tx.createTask(Anchor, null, background);
      const child = await tx.createConversation({
        ownership: { kind: "task" as const, taskId: anchor },
      });
      await configure(tx, child.id, {
        extensions: { remove: [SubagentExtension] },
        instructions: `You are the subagent "${name}". Answer the main agent's requests.`,
      });
      state.agents[name] = { conversationId: child.id, reported: [] };

      const input = {
        name,
        conversationId: child.id,
        message,
        followUp: false,
      };
      state.reporters[api.taskId as unknown as string] = await tx.createTask(
        Reporter,
        input,
        background,
      );
    }, callContext);

    const current = (
      await api.snapshot(Subagents, api.conversationId, callContext)
    )?.agents[name];
    return { success: true, conversationId: current?.conversationId };
  },

  async send(
    api: any,
    callContext: any,
    name: string,
    message: string,
    followUp?: boolean,
  ) {
    const registry = (await api.snapshot(
      Subagents,
      api.conversationId,
      callContext,
    )) ?? { agents: {} };
    const agent = registry.agents[name];
    if (!agent) return { error: `No subagent named ${name}.` };

    await api.commit(async (tx: any) => {
      const state = await tx.doc(Subagents, api.conversationId);
      const background = {
        ownership: { kind: "conversation" as const },
        background: true,
      } as const;
      const conversationId = state.agents[name]!.conversationId;
      const input = {
        name,
        conversationId,
        message,
        followUp: followUp === true,
      };
      state.reporters[api.taskId as unknown as string] = await tx.createTask(
        Reporter,
        input,
        background,
      );
    }, callContext);

    return { success: true, conversationId: agent.conversationId };
  },
};

export const subagentTool = defineTool({
  name: "manage_subagents",
  description:
    "Manage persistent subagents that work in the background. Actions: spawn (name, message), send (name, message; " +
    "followUp: true queues it after the current answer instead of steering), stop (name: aborts its current work), " +
    "status (name, or all subagents without one). Answers are reported back to you when they arrive.",
  parameters: Type.Object({
    action: Type.Union([
      Type.Literal("spawn"),
      Type.Literal("send"),
      Type.Literal("stop"),
      Type.Literal("status"),
    ]),
    name: Type.Optional(Type.String()),
    message: Type.Optional(Type.String()),
    followUp: Type.Optional(Type.Boolean()),
  }),
  replay: "unsafe",
  execute: async (args, api, callContext) => {
    const { action, name, message, followUp } = args;
    const reply = (text: string, conversationId?: ConversationId) => ({
      content: [{ type: "text" as const, text }],
      ...(conversationId === undefined || name === undefined
        ? {}
        : { details: { name, conversationId } }),
    });

    if (action === "status") {
      const statuses = await SubagentManager.getStatus(api, callContext, name);
      if (statuses.length === 0) return reply("No subagents.");
      return reply(statuses.map((s) => `${s.name}: ${s.state}`).join("\n"));
    }

    if (name === undefined) return reply(`${action} needs a name.`);

    if (action === "stop") {
      const res = await SubagentManager.stop(api, callContext, name);
      if (res.error) return reply(res.error);
      return reply(`Stopped ${name}.`, res.conversationId);
    }

    if (message === undefined) return reply(`${action} needs a message.`);

    if (action === "spawn") {
      const res = await SubagentManager.spawn(api, callContext, name, message);
      if (res.error) return reply(res.error);
      return reply(`Started ${name}.`, res.conversationId);
    }

    if (action === "send") {
      const res = await SubagentManager.send(
        api,
        callContext,
        name,
        message,
        followUp,
      );
      if (res.error) return reply(res.error);
      return reply(`Sent to ${name}.`, res.conversationId);
    }

    return reply(`Unknown action: ${action}`);
  },
});

export const SubagentExtension = defineExtension({
  name: "subagent-tools",
  tasks: [Anchor, Reporter],
  tools: [subagentTool],
});
