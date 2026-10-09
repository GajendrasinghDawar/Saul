import { createFileRoute, Link, useSearch } from '@tanstack/react-router'
import { KeyRound } from 'lucide-react'
import { useState } from 'react'
import { SaulBrand } from '../components/SaulBrand'
import { Button } from '../components/ui/Button'
import { Input } from '../components/ui/Input'

export const Route = createFileRoute('/reset-password')({
  component: ResetPasswordPage,
  validateSearch: (search: Record<string, unknown>) => ({
    token: (search.token as string) || '',
  }),
})

function ResetPasswordPage() {
  const { token } = useSearch({ from: '/reset-password' })
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    if (newPassword !== confirmPassword) {
      setError('Passwords do not match')
      return
    }
    if (newPassword.length < 8) {
      setError('Password must be at least 8 characters')
      return
    }

    setIsSubmitting(true)
    try {
      const response = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, newPassword }),
      })
      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.message || 'Unable to reset password')
      }
      setSuccess(true)
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Unable to reset password'
      )
      setIsSubmitting(false)
    }
  }

  if (!token) {
    return (
      <main className='flex min-h-svh items-center justify-center bg-slate2 p-4'>
        <section className='w-full max-w-sm rounded-xl border border-slate5 bg-slate3 p-7 shadow-5'>
          <SaulBrand className='mb-6' />
          <h1 className='text-2xl font-bold text-slate12'>Invalid link</h1>
          <p className='mt-2 text-sm leading-relaxed text-slate10'>
            This reset link is invalid or has expired.
          </p>
          <Link to='/forgot-password'>
            <Button className='mt-6 w-full' variant='primary'>
              Request a new link
            </Button>
          </Link>
        </section>
      </main>
    )
  }

  return (
    <main className='flex min-h-svh items-center justify-center bg-slate2 p-4'>
      <section className='w-full max-w-sm rounded-xl border border-slate5 bg-slate3 p-7 shadow-5'>
        <SaulBrand className='mb-6' />

        {success ? (
          <>
            <h1 className='text-2xl font-bold text-slate12'>Password reset!</h1>
            <p className='mt-2 text-sm leading-relaxed text-slate10'>
              Your password has been updated. You can now sign in with your new
              password.
            </p>
            <Link to='/login'>
              <Button className='mt-6 w-full' variant='primary'>
                Sign in
              </Button>
            </Link>
          </>
        ) : (
          <>
            <h1 className='text-2xl font-bold text-slate12'>
              Reset your password
            </h1>
            <p className='mt-2 text-sm leading-relaxed text-slate10'>
              Choose a new password for your account.
            </p>

            <form
              onSubmit={e => void handleReset(e)}
              className='mt-6 space-y-4'
            >
              <div>
                <label
                  htmlFor='newPassword'
                  className='mb-1.5 block text-sm font-medium text-slate11'
                >
                  New password
                </label>
                <Input
                  id='newPassword'
                  type='password'
                  placeholder='Min 8 characters'
                  value={newPassword}
                  onChange={e => setNewPassword(e.target.value)}
                  required
                  minLength={8}
                />
              </div>
              <div>
                <label
                  htmlFor='confirmPassword'
                  className='mb-1.5 block text-sm font-medium text-slate11'
                >
                  Confirm password
                </label>
                <Input
                  id='confirmPassword'
                  type='password'
                  placeholder='Repeat your password'
                  value={confirmPassword}
                  onChange={e => setConfirmPassword(e.target.value)}
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
                <KeyRound size={17} />
                {isSubmitting ? 'Resetting...' : 'Reset password'}
              </Button>
            </form>
          </>
        )}

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
