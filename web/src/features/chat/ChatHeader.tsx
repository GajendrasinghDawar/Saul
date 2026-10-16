import { useRouterState } from '@tanstack/react-router'
import { Separator, SidebarTrigger } from '../../components/ui/sidebar'
import { useSessions } from '../sessions/session-context'
import { useChatOutbox } from './chat-drafts'

export function ChatHeader() {
  const { sessions } = useSessions()
  const { main } = useChatOutbox()
  const pathname = useRouterState({ select: state => state.location.pathname })
  const sessionId = pathname.startsWith('/chat/')
    ? decodeURIComponent(pathname.replace(/^\/chat\/(?:thread\/)?/, ''))
    : null
  const conversationId = sessionId === 'main' ? main : sessionId
  const title = sessionId
    ? sessions.find(session => session.id === conversationId)?.title ||
      'New chat'
    : pathname.slice(1) || 'Saul'

  return (
    <header className='flex h-16 shrink-0 items-center gap-3 border-b border-slate4/50 px-2 md:px-4'>
      <SidebarTrigger />
      <Separator orientation='vertical' className='h-4' />
      <span
        className={`truncate text-sm font-medium text-slate11 ${sessionId ? '' : 'capitalize'}`}
      >
        {title}
      </span>
    </header>
  )
}
