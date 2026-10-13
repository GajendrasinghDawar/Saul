import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import type { ConversationId, EntryId, EntryRecord, Harness } from '@earendil-works/pi-durable'

export type ReplyReference = { entryId: number; role: 'user' | 'assistant'; text: string }
export type HistoryConversation = { conversationId: string; title: string | null }
export const replyPrefix = 'saul:reply:'
export const replyContextPrefix = 'saul:reply-context:'

/** Only persisted, visible prose. Never thinking, tools, or reference metadata. */
export function visibleEntry(entry: Pick<EntryRecord, 'kind' | 'model'>) {
  const role = entry.kind === 'pi.user' ? 'user' : entry.kind === 'pi.assistant' ? 'assistant' : undefined
  if (!role) return undefined
  const text = (entry.model ?? []).filter(message => message.role === role).flatMap(message => {
    if (typeof message.content === 'string') return [message.content]
    return message.content.flatMap(part => {
      if (part.type !== 'text') return []
      if (part.text.startsWith('saul:text:')) return [part.text.slice(10)]
      if (part.text.startsWith('saul:attachment:') || part.text.startsWith(replyPrefix) || part.text.startsWith(replyContextPrefix)) return []
      return [part.text]
    })
  }).join('\n').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '')
  return text.trim() ? { role, text } : undefined
}

export async function resolveReply(harness: Harness, conversationId: ConversationId, entryId: number): Promise<ReplyReference | undefined> {
  const conv = await harness.conversation(conversationId, BACKGROUND_CONTEXT)
  if (!conv) return undefined
  const page = await conv.entries({ minEntryId: entryId as EntryId, maxEntryId: entryId as EntryId }, 1, undefined, BACKGROUND_CONTEXT)
  const entry = page.items[0]
  const visible = entry && visibleEntry(entry)
  return visible ? { entryId, role: visible.role, text: visible.text.slice(0, 2000) } : undefined
}

/** A bounded page scans one owned conversation; continuation uses canonical entry bounds. */
export async function searchHistory(harness: Harness, conversations: HistoryConversation[], query: string, cursor?: string) {
  let index = 0
  let before: number | undefined
  if (cursor) {
    const match = /^(\d+):(\d*)$/.exec(cursor)
    if (!match) throw new Error('Invalid search cursor.')
    index = Number(match[1])
    before = match[2] ? Number(match[2]) : undefined
    if (!Number.isSafeInteger(index) || index >= conversations.length || (before !== undefined && (!Number.isSafeInteger(before) || before < 1))) throw new Error('Invalid search cursor.')
  }
  const results: (ReplyReference & { conversationId: string; title: string | null })[] = []
  let scanned = 0
  let nextCursor: string | null = null
  const source = conversations[index]
  if (source) {
    const conv = await harness.conversation(Number(source.conversationId) as ConversationId, BACKGROUND_CONTEXT)
    if (conv) {
      const page = await conv.entries(before === undefined ? {} : { maxEntryId: before as EntryId }, 200, undefined, BACKGROUND_CONTEXT)
      scanned = page.items.length
      for (const entry of page.items) {
        const visible = visibleEntry(entry)
        if (!visible) continue
        const position = visible.text.toLocaleLowerCase().indexOf(query.toLocaleLowerCase())
        if (position < 0) continue
        const start = Math.max(0, position - 100)
        results.push({ conversationId: source.conversationId, title: source.title, entryId: Number(entry.id), role: visible.role, text: visible.text.slice(start, start + 400) })
      }
      const last = page.items.at(-1)
      if (page.next && last && Number(last.id) > 1) nextCursor = `${index}:${Number(last.id) - 1}`
    }
    if (!nextCursor && index + 1 < conversations.length) nextCursor = `${index + 1}:`
  }
  return { results, scanned, truncated: nextCursor !== null, nextCursor, limits: { entriesPerPage: 200, excerptCharacters: 400 } }
}
