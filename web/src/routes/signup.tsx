import { createFileRoute, Link } from '@tanstack/react-router'
import { Sparkles, UserPlus } from 'lucide-react'
import { useState } from 'react'
import { Button } from '../components/ui/Button'
import { Input } from '../components/ui/Input'

export const Route = createFileRoute('/signup')({ component: SignupPage })

function SignupPage() {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setIsSubmitting(true)
    try {
      const response = await fetch('/api/auth/sign-up/email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, password }),
      })
      const data = await response.json()
      if (!response.ok) {
        throw new Error(data.message || 'Unable to create account')
      }

      const searchParams = new URLSearchParams(window.location.search)
      if (searchParams.get('client') === 'android') {
        const token = data.token || data.session?.token || data.session?.id || ''
        window.location.href = `saul://auth?token=${token}`
        return
      }

      window.location.href = '/'
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Unable to create account'
      )
      setIsSubmitting(false)
    }
  }

  return (
    <main className='flex min-h-svh items-center justify-center bg-slate2 p-4'>
      <section className='w-full max-w-sm rounded-xl border border-slate5 bg-slate3 p-7 shadow-5'>
        <div className='mb-6 flex size-10 rotate-3 items-center justify-center rounded-lg border border-crimson7 bg-crimson4 text-crimson11 shadow-2'>
          <Sparkles size={19} />
        </div>
        <h1 className='text-2xl font-bold text-slate12'>Create your account</h1>
        <p className='mt-2 text-sm leading-relaxed text-slate10'>
          Get started with Lali, your personal assistant.
        </p>

        <form onSubmit={e => void handleSignup(e)} className='mt-6 space-y-4'>
          <div>
            <label
              htmlFor='name'
              className='mb-1.5 block text-sm font-medium text-slate11'
            >
              Name
            </label>
            <Input
              id='name'
              type='text'
              placeholder='Your name'
              value={name}
              onChange={e => setName(e.target.value)}
              required
            />
          </div>
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
              placeholder='Min 8 characters'
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              minLength={8}
            />
          </div>

          <Button
            className='w-full'
            variant='primary'
            disabled={isSubmitting}
            type='submit'
          >
            <UserPlus size={17} />
            {isSubmitting ? 'Creating account...' : 'Create account'}
          </Button>
        </form>

        <p className='mt-6 text-center text-sm text-slate10'>
          Already have an account?{' '}
          <Link
            to='/login'
            search={(prev) => prev}
            className='text-crimson11 hover:text-crimson10 hover:underline'
          >
            Sign in
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
