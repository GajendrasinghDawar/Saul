import type { JsonValue } from '@earendil-works/chord'
import type {
  ConversationId,
  Cursor,
  TaskRecord,
  Tx,
} from '@earendil-works/pi-durable'
import { getSecret, settingDefinitions } from '../secretsManager.ts'

export type AttentionItem = {
  id: string
  type: 'approval' | 'reminder' | 'failure' | 'result'
  title: string
  text: string
  timestamp: string | null
  source: {
    conversationId: string
    entryId: string | null
    href: string
  } | null
  approvalId: string | null
}
export type AttentionResponse = {
  generatedAt: string
  groups: {
    approvals: AttentionItem[]
    reminders: AttentionItem[]
    failures: AttentionItem[]
    results: AttentionItem[]
  }
}

// Only display-purpose text crosses this boundary, never task inputs, outcomes,
// checkpoints, provider errors or model payloads wholesale.
export function attentionText(value: string): string {
  let text = value
  for (const [name, definition] of Object.entries(settingDefinitions)) {
    const secret = definition.kind === 'secret' ? getSecret(name) : ''
    if (secret) text = text.replaceAll(secret, '[redacted]')
  }
  for (const [name, secret] of Object.entries(process.env)) {
    if (secret && /KEY|TOKEN|SECRET|PASSWORD/i.test(name))
      text = text.replaceAll(secret, '[redacted]')
  }
  return (
    text
      .replace(
        /\b(?:Bearer\s+\S+|(?:sk-|re_)[a-zA-Z0-9_-]{16,})/gi,
        '[redacted]'
      )
      .replace(
        /\b(password|token|secret|api[_ -]?key)\s*[:=]\s*\S+/gi,
        '$1=[redacted]'
      )
      .replace(/https?:\/\/\S+/gi, '[link omitted]')
      // biome-ignore lint/suspicious/noControlCharactersInRegex: remove control characters from display text
      .replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, ' ')
      .slice(0, 500)
  )
}

export function attentionSource(
  conversationId: string,
  entryId: string | null = null
): NonNullable<AttentionItem['source']> {
  return {
    conversationId,
    entryId,
    href: `/chat/${encodeURIComponent(conversationId)}${entryId ? `?entry=${encodeURIComponent(entryId)}` : ''}`,
  }
}

export async function scanOwnedTasks(tx: Tx, conversationIds: string[]) {
  const tasks: TaskRecord<JsonValue, JsonValue, JsonValue>[] = []
  for (const id of conversationIds) {
    let cursor: Cursor | undefined
    do {
      const page = await tx.scanTasks(
        { conversationId: Number(id) as ConversationId },
        100,
        cursor
      )
      tasks.push(
        ...page.items.filter(task => String(task.conversationId) === id)
      )
      cursor = page.next
    } while (cursor)
  }
  return tasks
}

export async function taskAttention(
  tx: Tx,
  tasks: TaskRecord<JsonValue, JsonValue, JsonValue>[],
  now: number
) {
  const groups: Pick<
    AttentionResponse['groups'],
    'reminders' | 'failures' | 'results'
  > = {
    reminders: [],
    failures: [],
    results: [],
  }
  for (const task of tasks) {
    const base = {
      id: `task:${task.id}`,
      timestamp: null as string | null,
      source: attentionSource(String(task.conversationId)),
      approvalId: null,
    }
    const outcome = task.state.outcome
    if (outcome && ['failed', 'faulted', 'orphaned'].includes(outcome.status)) {
      groups.failures.push({
        ...base,
        type: 'failure',
        title: 'Task needs attention',
        text: `${task.kind === 'lali.reminder' ? 'Reminder' : task.kind === 'lali.subagent-reporter' ? 'Subagent report' : 'Background task'} could not finish. Open the source conversation for context.`,
      })
      continue
    }
    const input = task.input
    if (
      task.kind === 'lali.reminder' &&
      input &&
      typeof input === 'object' &&
      !Array.isArray(input) &&
      typeof input.at === 'number' &&
      Number.isFinite(input.at) &&
      Math.abs(input.at) <= 8.64e15 &&
      typeof input.message === 'string' &&
      input.at <= now &&
      (!outcome || outcome.status === 'completed')
    ) {
      const submission = await tx.submissionByRequest(
        task.conversationId,
        `reminder-${task.id}`
      )
      groups.reminders.push({
        ...base,
        type: 'reminder',
        title: outcome ? 'Reminder delivered' : 'Reminder due',
        text: attentionText(input.message),
        timestamp: new Date(input.at).toISOString(),
        source: attentionSource(
          String(task.conversationId),
          submission?.entry ? String(submission.entry) : null
        ),
      })
    }
    // Reporter tasks return null and discard their report checkpoint on completion.
    // A persisted report submission proves there really was a delivered result;
    // a completed anchor, tool, turn or empty reporter is not an inbox result.
    if (
      task.kind === 'lali.subagent-reporter' &&
      task.state.status === 'terminal' &&
      outcome?.status === 'completed'
    ) {
      const submission = await tx.submissionByRequest(
        task.conversationId,
        `subagent-report:${task.id}`
      )
      if (!submission?.entry) continue
      const entry = await tx.entry(submission.entry)
      if (
        !entry ||
        String(entry.conversationId) !== String(task.conversationId)
      )
        continue
      const timestamp = entry.model?.find(message =>
        Number.isFinite(message.timestamp)
      )?.timestamp
      groups.results.push({
        ...base,
        type: 'result',
        title: 'Subagent report delivered',
        text: 'A delegated agent returned a report. Open the source to read the result.',
        timestamp:
          timestamp && Math.abs(timestamp) <= 8.64e15
            ? new Date(timestamp).toISOString()
            : null,
        source: attentionSource(String(task.conversationId), String(entry.id)),
      })
    }
  }
  return groups
}
