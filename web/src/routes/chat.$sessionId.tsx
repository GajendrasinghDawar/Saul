import { createFileRoute } from '@tanstack/react-router'
import { ChatPage } from '../features/chat/ChatPage'

export const Route = createFileRoute('/chat/$sessionId')({
  validateSearch: (search: Record<string, unknown>): { entry?: string } => ({
    entry: /^\d+$/.test(String(search.entry ?? ''))
      ? String(search.entry)
      : undefined,
  }),
  component: ChatRouteComponent,
})

function ChatRouteComponent() {
  const { sessionId } = Route.useParams()
  const { entry } = Route.useSearch()
  return <ChatPage sessionId={sessionId} targetEntryId={entry} />
}
