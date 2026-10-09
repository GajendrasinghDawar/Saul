import { createFileRoute, Link } from '@tanstack/react-router'
import { LogIn } from 'lucide-react'
import { useState } from 'react'
import { SaulBrand } from '../components/SaulBrand'
import { Button } from '../components/ui/Button'
import { Input } from '../components/ui/Input'

export const Route = createFileRoute('/login')({ component: LoginPage })

function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setIsSubmitting(true)
    try {
      const response = await fetch('/api/auth/sign-in/email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })
      const data = await response.json()
      if (!response.ok) {
        throw new Error(data.message || 'Invalid email or password')
      }

      const searchParams = new URLSearchParams(window.location.search)
      if (searchParams.get('client') === 'android') {
        const token =
          data.token || data.session?.token || data.session?.id || ''
        window.location.href = `saul://auth?token=${token}`
        return
      }

      const redirectTo = searchParams.get('redirect')
      if (redirectTo && redirectTo.startsWith('/')) {
        window.location.href = redirectTo
      } else {
        window.location.href = '/'
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to sign in')
      setIsSubmitting(false)
    }
  }

  return (
    <main className='flex min-h-svh items-center justify-center bg-slate2 p-4'>
      <section className='w-full max-w-sm rounded-xl border border-slate5 bg-slate3 p-7 shadow-5'>
        <SaulBrand className='mb-6' />
        <h1 className='text-2xl font-bold text-slate12'>Sign in to Saul</h1>
        <p className='mt-2 text-sm leading-relaxed text-slate10'>
          Access your sessions, mail, and assistant workspace.
        </p>

        <form onSubmit={e => void handleLogin(e)} className='mt-6 space-y-4'>
          <div>
            <label
              htmlFor='email'
              className='mb-1.5 block text-sm font-medium text-slate11'
            >
              Email
            </label>
            <Input
              id='email'
              type='email'
              placeholder='you@example.com'
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
            />
          </div>
          <div>
            <label
              htmlFor='password'
              className='mb-1.5 block text-sm font-medium text-slate11'
            >
              Password
            </label>
            <Input
              id='password'
              type='password'
              placeholder='••••••••'
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
            />
          </div>

          <div className='flex justify-end'>
            <Link
              to='/forgot-password'
              className='text-xs text-crimson11 hover:text-crimson10 hover:underline'
            >
              Forgot password?
            </Link>
          </div>

          <Button
            className='w-full'
            variant='primary'
            disabled={isSubmitting}
            type='submit'
          >
            <LogIn size={17} />
            {isSubmitting ? 'Signing in...' : 'Sign in'}
          </Button>
        </form>

        <p className='mt-6 text-center text-sm text-slate10'>
          Don't have an account?{' '}
          <Link
            to='/signup'
            search={prev => prev}
            className='text-crimson11 hover:text-crimson10 hover:underline'
          >
            Sign up
          </Link>
        </p>

        {error && (
          <p
            role='alert'
            className='mt-4 rounded-md border border-red7 bg-red3 p-3 text-sm text-red11'
          >
            {error}
          </p>
        )}
      </section>
    </main>
  )
}
