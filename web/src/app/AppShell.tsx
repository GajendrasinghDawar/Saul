import { Outlet } from '@tanstack/react-router'
import { Toaster } from 'sonner'
import { SidebarInset, SidebarProvider } from '../components/ui/sidebar'
import { ChatHeader } from '../features/chat/ChatHeader'
import { ChatDraftProvider } from '../features/chat/chat-drafts'
import { SessionSidebar } from '../features/sessions/SessionSidebar'
import { SessionProvider } from '../features/sessions/session-context'

export function AppShell() {
  return (
    <SessionProvider>
      <ChatDraftProvider>
        <SidebarProvider>
          <SessionSidebar />
          <SidebarInset className='h-svh overflow-hidden'>
            <ChatHeader />
            <main className='min-h-0 flex-1'>
              <Outlet />
            </main>
          </SidebarInset>
          <Toaster position='top-center' />
        </SidebarProvider>
      </ChatDraftProvider>
    </SessionProvider>
  )
}
