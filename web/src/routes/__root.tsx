import { createRootRoute, Outlet, useRouterState } from '@tanstack/react-router'
import { AppShell } from '../app/AppShell'
import { AuthGate } from '../features/auth/AuthGate'

export const Route = createRootRoute({
  component: RootComponent,
})

function RootComponent() {
  const routerState = useRouterState()
  const isAuthPage =
    routerState.location.pathname === '/login' ||
    routerState.location.pathname === '/signup' ||
    routerState.location.pathname.startsWith('/forgot-password') ||
    routerState.location.pathname.startsWith('/reset-password')

  return (
    <>
      {isAuthPage ? (
        <Outlet />
      ) : (
        <AuthGate>
          <AppShell />
        </AuthGate>
      )}
    </>
  )
}
