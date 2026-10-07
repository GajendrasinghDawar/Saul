import { Outlet } from '@tanstack/react-router'
import { Toaster } from 'sonner'
import { SidebarInset, SidebarProvider } from '../components/ui/sidebar'
import { ChatHeader } from '../features/chat/ChatHeader'
import { SessionSidebar } from '../features/sessions/SessionSidebar'

export function AppShell() {
  return (
    <SidebarProvider>
      <SessionSidebar />
      <SidebarInset className='h-svh overflow-hidden'>
        <ChatHeader />
        <main className='min-h-0 flex-1'>
          <Outlet />
        </main>
      </SidebarInset>
      <Toaster position="top-center" />
    </SidebarProvider>
  )
}
