import { createRootRoute, Outlet, useRouterState } from "@tanstack/react-router";
import { AuthGate } from "../features/auth/AuthGate";
import { AppShell } from "../app/AppShell";

export const Route = createRootRoute({
  component: RootComponent,
});

function RootComponent() {
  const routerState = useRouterState();
  const isAuthPage = routerState.location.pathname === "/login" || 
                     routerState.location.pathname === "/signup" ||
                     routerState.location.pathname.startsWith("/forgot-password") ||
                     routerState.location.pathname.startsWith("/reset-password");

  return (
    <>
      {isAuthPage ? <Outlet /> : (
        <AuthGate>
          <AppShell />
        </AuthGate>
      )}
    </>
  );
}
