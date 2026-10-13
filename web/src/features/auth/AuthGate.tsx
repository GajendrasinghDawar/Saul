import { useNavigate } from '@tanstack/react-router'
import { createContext, useContext, useEffect, useState } from 'react'
import { initCsrfToken } from '../../lib/api'

const AuthenticatedUserContext = createContext<string | null>(null)
export function useAuthenticatedUserId() {
  const userId = useContext(AuthenticatedUserContext)
  if (!userId) throw new Error('An authenticated user is required.')
  return userId
}

export function AuthGate({ children }: { children: React.ReactNode }) {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null)
  const [userId, setUserId] = useState<string | null>(null)
  const navigate = useNavigate()

  useEffect(() => {
    let active = true
    fetch('/api/auth/get-session')
      .then(res => res.json())
      .then(data => {
        if (!active) return
        if (data?.session && typeof data?.user?.id === 'string') {
          initCsrfToken().then(() => {
            if (!active) return
            setUserId(data.user.id)
            setIsAuthenticated(true)
          })
        } else {
          setIsAuthenticated(false)
          navigate({ to: '/login' })
        }
      })
      .catch(() => {
        if (!active) return
        setIsAuthenticated(false)
        navigate({ to: '/login' })
      })
    return () => { active = false }
  }, [navigate])

  if (isAuthenticated === null)
    return (
      <div className='flex min-h-svh items-center justify-center bg-slate2 text-sm text-slate10'>
        Loading Saul...
      </div>
    )
  if (!isAuthenticated) return null

  return <AuthenticatedUserContext value={userId}>{children}</AuthenticatedUserContext>
}
