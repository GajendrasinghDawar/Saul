import { Link, useNavigate, useRouterState } from '@tanstack/react-router'
import {
  Activity,
  Edit2,
  MessageSquare,
  MoreHorizontal,
  Plus,
  Settings,
  Trash2,
} from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { Button } from '../../components/ui/Button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '../../components/ui/Dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../../components/ui/DropdownMenu'
import { Input } from '../../components/ui/Input'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarLabel,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuIcon,
  SidebarMenuItem,
  SidebarSeparator,
  useSidebar,
} from '../../components/ui/sidebar'
import { UserMenu } from '../auth/UserMenu'
import {
  createSession,
  deleteSession,
  fetchSessions,
  renameSession,
  type SessionItem,
} from './session-api'

const primaryNavigation = [
  { to: '/tasks', label: 'Tasks', icon: Activity },
  { to: '/settings', label: 'Settings', icon: Settings },
] as const

export function SessionSidebar() {
  const { setOpenMobile } = useSidebar()
  const [sessions, setSessions] = useState<SessionItem[]>([])
  const [isCreating, setIsCreating] = useState(false)
  const pathname = useRouterState({ select: state => state.location.pathname })
  const navigate = useNavigate()

  const loadSessions = useCallback(async () => {
    try {
      const items = await fetchSessions()
      // Sort by recently updated
      items.sort((a, b) => b.updated - a.updated)
      setSessions(items)
    } catch (e) {
      console.error(e)
    }
  }, [])

  useEffect(() => {
    void loadSessions()
    const handleChatUpdated = () => void loadSessions()
    window.addEventListener('chat-updated', handleChatUpdated)
    window.addEventListener('visibilitychange', handleChatUpdated)
    return () => {
      window.removeEventListener('chat-updated', handleChatUpdated)
      window.removeEventListener('visibilitychange', handleChatUpdated)
    }
  }, [loadSessions])

  const [renameSessionObj, setRenameSessionObj] = useState<SessionItem | null>(
    null
  )
  const [deleteSessionObj, setDeleteSessionObj] = useState<SessionItem | null>(
    null
  )
  const [newTitle, setNewTitle] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleCreateChat = async () => {
    if (isCreating) return
    setIsCreating(true)
    try {
      const newId = await createSession()
      await loadSessions()
      navigate({ to: '/chat/$sessionId', params: { sessionId: newId } })
      setOpenMobile(false)
    } catch (e) {
      console.error(e)
    } finally {
      setIsCreating(false)
    }
  }

  const handleRename = async () => {
    if (!renameSessionObj) return
    const currentTitle = renameSessionObj.title || `Chat ${renameSessionObj.id}`
    if (newTitle?.trim() && newTitle !== currentTitle) {
      setIsSubmitting(true)
      try {
        await renameSession(renameSessionObj.id, newTitle.trim())
        await loadSessions()
        setRenameSessionObj(null)
      } catch (e) {
        console.error('Failed to rename session', e)
      } finally {
        setIsSubmitting(false)
      }
    } else {
      setRenameSessionObj(null)
    }
  }

  const handleDelete = async () => {
    if (!deleteSessionObj) return
    setIsSubmitting(true)
    try {
      await deleteSession(deleteSessionObj.id)
      await loadSessions()
      if (pathname === `/chat/${deleteSessionObj.id}`) {
        navigate({ to: '/' })
      }
      setDeleteSessionObj(null)
    } catch (e) {
      console.error('Failed to delete session', e)
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <>
      <Sidebar collapsible='icon'>
        <SidebarHeader>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                asChild
                size='lg'
                tooltip='Lali'
                className='text-crimson10'
              >
                <Link to='/' onClick={() => setOpenMobile(false)}>
                  <SidebarMenuIcon
                    layout='position'
                    className='flex size-8 shrink-0 rotate-3 items-center justify-center rounded-lg border border-crimson7 bg-crimson4 text-sm font-black shadow-2'
                  >
                    L
                  </SidebarMenuIcon>
                  <SidebarLabel className='text-xl font-bold tracking-tight'>
                    Lali
                  </SidebarLabel>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarHeader>

        <SidebarContent>
          <SidebarGroup className='pb-1'>
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    variant='outline'
                    tooltip='New chat'
                    onClick={() => void handleCreateChat()}
                    disabled={isCreating}
                  >
                    <SidebarMenuIcon
                      layout='position'
                      className='flex shrink-0'
                    >
                      <Plus />
                    </SidebarMenuIcon>
                    <SidebarLabel>
                      {isCreating ? 'Creating...' : 'New chat'}
                    </SidebarLabel>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>

          <SidebarGroup className='py-1'>
            <SidebarGroupContent>
              <SidebarMenu>
                {primaryNavigation.map(item => {
                  const Icon = item.icon
                  return (
                    <SidebarMenuItem key={item.to}>
                      <SidebarMenuButton
                        asChild
                        isActive={pathname === item.to}
                        tooltip={item.label}
                      >
                        <Link to={item.to} onClick={() => setOpenMobile(false)}>
                          <SidebarMenuIcon
                            layout='position'
                            className='flex shrink-0'
                          >
                            <Icon />
                          </SidebarMenuIcon>
                          <SidebarLabel>{item.label}</SidebarLabel>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  )
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>

          <SidebarSeparator />

          <SidebarGroup>
            <SidebarGroupLabel>Chats</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {/* Always show main conversation first */}
                <SidebarMenuItem>
                  <SidebarMenuButton
                    asChild
                    isActive={pathname === '/chat/main'}
                    tooltip='Main Thread'
                  >
                    <Link
                      to='/chat/$sessionId'
                      params={{ sessionId: 'main' }}
                      onClick={() => setOpenMobile(false)}
                    >
                      <SidebarMenuIcon
                        layout='position'
                        className='flex shrink-0'
                      >
                        <MessageSquare />
                      </SidebarMenuIcon>
                      <SidebarLabel className='flex w-full items-center justify-between'>
                        <span className='truncate font-semibold'>
                          Main Thread
                        </span>
                      </SidebarLabel>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>

                {sessions.map(session => {
                  // pi-durable root conversation usually has id 1, we map that to 'main' thread
                  if (session.id === '1') return null

                  const active = pathname === `/chat/${session.id}`
                  const title = session.title || `Chat ${session.id}`

                  return (
                    <SidebarMenuItem key={session.id}>
                      <SidebarMenuButton
                        asChild
                        isActive={active}
                        tooltip={title}
                      >
                        <Link
                          to='/chat/$sessionId'
                          params={{ sessionId: session.id }}
                          onClick={() => setOpenMobile(false)}
                        >
                          <SidebarMenuIcon
                            layout='position'
                            className='flex shrink-0'
                          >
                            <MessageSquare />
                          </SidebarMenuIcon>
                          <SidebarLabel className='flex w-full items-center justify-between'>
                            <span className='truncate'>{title}</span>
                          </SidebarLabel>
                        </Link>
                      </SidebarMenuButton>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <SidebarMenuAction showOnHover>
                            <MoreHorizontal className='h-4 w-4' />
                            <span className='sr-only'>More</span>
                          </SidebarMenuAction>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent
                          className='w-48'
                          side='bottom'
                          align='end'
                        >
                          <DropdownMenuItem
                            onClick={() => {
                              setRenameSessionObj(session)
                              setNewTitle(session.title || `Chat ${session.id}`)
                            }}
                          >
                            <Edit2 className='mr-2 h-4 w-4' />
                            <span>Rename</span>
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => setDeleteSessionObj(session)}
                            className='text-destructive focus:text-destructive'
                          >
                            <Trash2 className='mr-2 h-4 w-4' />
                            <span>Delete</span>
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </SidebarMenuItem>
                  )
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>

        <SidebarSeparator />
        <SidebarFooter>
          <UserMenu />
        </SidebarFooter>
      </Sidebar>

      <Dialog
        open={!!renameSessionObj}
        onOpenChange={open => !open && setRenameSessionObj(null)}
      >
        <DialogContent>
          <DialogTitle>Rename Chat</DialogTitle>
          <DialogDescription>
            Enter a new title for this conversation.
          </DialogDescription>
          <div className='py-4'>
            <Input
              value={newTitle}
              onChange={e => setNewTitle(e.target.value)}
              placeholder='Chat title'
              autoFocus
              onKeyDown={e => {
                if (e.key === 'Enter') handleRename()
              }}
            />
          </div>
          <div className='flex justify-end gap-2'>
            <Button
              variant='secondary'
              onClick={() => setRenameSessionObj(null)}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button
              onClick={handleRename}
              disabled={isSubmitting || !newTitle.trim()}
            >
              Save
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!deleteSessionObj}
        onOpenChange={open => !open && setDeleteSessionObj(null)}
      >
        <DialogContent>
          <DialogTitle>Delete Chat</DialogTitle>
          <DialogDescription>
            Are you sure you want to delete this chat? This action cannot be
            undone.
          </DialogDescription>
          <div className='flex justify-end gap-2 mt-4'>
            <Button
              variant='secondary'
              onClick={() => setDeleteSessionObj(null)}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button
              variant='destructive'
              onClick={handleDelete}
              disabled={isSubmitting}
            >
              Delete
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
