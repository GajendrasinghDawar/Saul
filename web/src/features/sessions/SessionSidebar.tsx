import { useCallback, useEffect, useState } from "react";
import { Bell, Inbox, MessageSquare, Settings, Plus } from "lucide-react";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { Button } from "../../components/ui/Button";
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
  SidebarMenuButton,
  SidebarMenuIcon,
  SidebarMenuItem,
  SidebarSeparator,
  useSidebar,
} from "../../components/ui/sidebar";
import { UserMenu } from "../auth/UserMenu";
import { fetchSessions, createSession, SessionItem } from "./session-api";

const primaryNavigation = [
  { to: "/mail", label: "Mail", icon: Inbox },
  { to: "/notifications", label: "Notifications", icon: Bell },
  { to: "/settings", label: "Settings", icon: Settings },
] as const;

export function SessionSidebar() {
  const { setOpenMobile } = useSidebar();
  const [sessions, setSessions] = useState<SessionItem[]>([]);
  const [isCreating, setIsCreating] = useState(false);
  const pathname = useRouterState({ select: state => state.location.pathname });
  const navigate = useNavigate();

  const loadSessions = useCallback(async () => {
    try {
      const items = await fetchSessions();
      // Sort by recently updated
      items.sort((a, b) => b.updated - a.updated);
      setSessions(items);
    } catch (e) {
      console.error(e);
    }
  }, []);

  useEffect(() => { 
    void loadSessions(); 
  }, [loadSessions]);

  const handleCreateChat = async () => {
    if (isCreating) return;
    setIsCreating(true);
    try {
      const newId = await createSession();
      await loadSessions();
      navigate({ to: "/chat/$sessionId", params: { sessionId: newId } });
      setOpenMobile(false);
    } catch (e) {
      console.error(e);
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild size="lg" tooltip="Lali" className="text-crimson10">
              <Link to="/" onClick={() => setOpenMobile(false)}>
                <SidebarMenuIcon layout="position" className="flex size-8 shrink-0 rotate-3 items-center justify-center rounded-lg border border-crimson7 bg-crimson4 text-sm font-black shadow-2">L</SidebarMenuIcon>
                <SidebarLabel className="text-xl font-bold tracking-tight">Lali</SidebarLabel>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup className="pb-1">
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton variant="outline" tooltip="New chat" onClick={() => void handleCreateChat()} disabled={isCreating}>
                  <SidebarMenuIcon layout="position" className="flex shrink-0"><Plus /></SidebarMenuIcon>
                  <SidebarLabel>{isCreating ? "Creating..." : "New chat"}</SidebarLabel>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup className="py-1">
          <SidebarGroupContent>
            <SidebarMenu>
              {primaryNavigation.map(item => {
                const Icon = item.icon;
                return (
                  <SidebarMenuItem key={item.to}>
                    <SidebarMenuButton asChild isActive={pathname === item.to} tooltip={item.label}>
                      <Link to={item.to} onClick={() => setOpenMobile(false)}>
                        <SidebarMenuIcon layout="position" className="flex shrink-0"><Icon /></SidebarMenuIcon>
                        <SidebarLabel>{item.label}</SidebarLabel>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
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
                <SidebarMenuButton asChild isActive={pathname === "/chat/main"} tooltip="Main Thread">
                  <Link to="/chat/$sessionId" params={{ sessionId: "main" }} onClick={() => setOpenMobile(false)}>
                    <SidebarMenuIcon layout="position" className="flex shrink-0"><MessageSquare /></SidebarMenuIcon>
                    <SidebarLabel className="flex w-full items-center justify-between">
                      <span className="truncate font-semibold">Main Thread</span>
                    </SidebarLabel>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>

              {sessions.map(session => {
                // pi-durable root conversation usually has id 1, we map that to 'main' thread
                if (session.id === "1") return null; 

                const active = pathname === `/chat/${session.id}`;
                const title = `Chat ${session.id}`;
                
                return (
                  <SidebarMenuItem key={session.id}>
                    <SidebarMenuButton asChild isActive={active} tooltip={title}>
                      <Link to="/chat/$sessionId" params={{ sessionId: session.id }} onClick={() => setOpenMobile(false)}>
                        <SidebarMenuIcon layout="position" className="flex shrink-0"><MessageSquare /></SidebarMenuIcon>
                        <SidebarLabel className="flex w-full items-center justify-between">
                          <span className="truncate">{title}</span>
                        </SidebarLabel>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarSeparator />
      <SidebarFooter><UserMenu /></SidebarFooter>
    </Sidebar>
  );
}
