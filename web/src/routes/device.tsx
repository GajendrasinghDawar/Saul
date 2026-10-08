import { createFileRoute } from '@tanstack/react-router'
import { Check, ShieldAlert, X } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { Button } from '../components/ui/Button'
import { Input } from '../components/ui/Input'

interface LogEntry {
  id: string
  message: string
}

export const Route = createFileRoute('/device')({
  component: DevicePage,
})

function DevicePage() {
  const searchParams = new URLSearchParams(window.location.search)
  const initialUserCode = searchParams.get('user_code') || ''
  const [userCode, setUserCode] = useState(initialUserCode)
  const [error, setError] = useState<string | null>(null)
  const [isProcessing, setIsProcessing] = useState(false)
  const [requestInfo, setRequestInfo] = useState<{
    client_id?: string
    scope?: string
  } | null>(null)

  const [stepLogs, setStepLogs] = useState<LogEntry[]>([])

  const addLog = useCallback((msg: string) => {
    setStepLogs(prev => [
      ...prev,
      {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        message: `${new Date().toLocaleTimeString()}: ${msg}`,
      },
    ])
  }, [])

  const verifyCode = useCallback(
    async (code: string) => {
      setError(null)
      setIsProcessing(true)
      addLog(`Checking device code [${code}] with Gateway...`)
      try {
        const response = await fetch(
          `/api/auth/device?user_code=${encodeURIComponent(code)}`
        )
        if (response.status === 401) {
          addLog('Session unauthenticated. Redirecting to login...')
          const verificationPath = `/device?user_code=${encodeURIComponent(code)}`
          window.location.href = `/login?redirect=${encodeURIComponent(verificationPath)}`
          return
        }
        const data = await response.json()
        if (!response.ok) {
          throw new Error(
            data.message || data.error_description || 'Invalid or expired code'
          )
        }

        if (data.status === 'approved') {
          addLog('Device code is ALREADY approved!')
          setSuccess(true)
          return
        }

        addLog(
          `Device identified: ${data.client_id || 'android-client'} (Awaiting your confirmation)`
        )
        setRequestInfo(data)
      } catch (cause) {
        const err =
          cause instanceof Error ? cause.message : 'Unable to verify code'
        addLog(`Error: ${err}`)
        setError(err)
      } finally {
        setIsProcessing(false)
      }
    },
    [addLog]
  )

  useEffect(() => {
    if (initialUserCode) {
      addLog(`Detected code from link: ${initialUserCode}`)
      verifyCode(initialUserCode)
    }
  }, [initialUserCode, verifyCode, addLog])

  const handleVerifySubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const formattedCode = userCode.trim().replace(/-/g, '').toUpperCase()
    void verifyCode(formattedCode)
  }

  const [success, setSuccess] = useState(false)

  const handleAction = async (action: 'approve' | 'deny') => {
    setError(null)
    setIsProcessing(true)
    addLog(`Submitting decision: ${action.toUpperCase()}...`)
    try {
      const response = await fetch(`/api/auth/device/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userCode: userCode.trim().replace(/-/g, '').toUpperCase(),
        }),
      })
      const text = await response.text()
      const data = text ? JSON.parse(text) : {}

      if (!response.ok) {
        throw new Error(
          data.message || data.error_description || `Failed to ${action} device`
        )
      }

      addLog(`Action ${action} successful! Device authorized.`)
      setSuccess(true)
    } catch (cause) {
      const err =
        cause instanceof Error ? cause.message : `Failed to ${action} device`
      addLog(`Error: ${err}`)
      setError(err)
      setIsProcessing(false)
    }
  }

  if (success) {
    return (
      <main className='flex min-h-svh items-center justify-center bg-slate2 p-4'>
        <section className='w-full max-w-sm rounded-xl border border-slate5 bg-slate3 p-7 shadow-5 text-center'>
          <div className='mx-auto mb-6 flex size-12 items-center justify-center rounded-full bg-jade4 text-jade11 border border-jade6'>
            <Check size={28} />
          </div>
          <h1 className='text-2xl font-bold text-slate12'>Device Approved</h1>
          <p className='mt-2 text-sm leading-relaxed text-slate10'>
            Authorization completed for code{' '}
            <span className='font-mono font-semibold text-jade11'>
              {userCode}
            </span>
            .
          </p>
          <div className='mt-4 rounded-lg bg-slate4 p-3 text-xs text-slate11 text-left font-mono'>
            <div>✓ Gateway verification passed</div>
            <div>✓ User consent granted</div>
            <div>✓ Session token dispatched to device</div>
          </div>
          <p className='mt-4 text-xs font-medium text-slate11'>
            You can now close this tab and return to the Android app.
          </p>
        </section>
      </main>
    )
  }

  return (
    <main className='flex min-h-svh items-center justify-center bg-slate2 p-4'>
      <section className='w-full max-w-sm rounded-xl border border-slate5 bg-slate3 p-7 shadow-5'>
        <div className='mb-6 flex size-10 items-center justify-center rounded-lg border border-indigo7 bg-indigo4 text-indigo11 shadow-2'>
          <ShieldAlert size={19} />
        </div>
        <h1 className='text-2xl font-bold text-slate12'>Connect Device</h1>

        {!requestInfo ? (
          <>
            <p className='mt-2 text-sm leading-relaxed text-slate10'>
              Enter the code displayed on your device to grant it access to your
              account.
            </p>
            <form onSubmit={handleVerifySubmit} className='mt-6 space-y-4'>
              <div>
                <label
                  htmlFor='userCode'
                  className='mb-1.5 block text-sm font-medium text-slate11'
                >
                  Device Code
                </label>
                <Input
                  id='userCode'
                  type='text'
                  placeholder='ABCD-1234'
                  value={userCode}
                  onChange={e => setUserCode(e.target.value)}
                  maxLength={12}
                  required
                />
              </div>
              <Button
                className='w-full'
                variant='primary'
                disabled={isProcessing}
                type='submit'
              >
                {isProcessing ? 'Verifying...' : 'Continue'}
              </Button>
            </form>
          </>
        ) : (
          <>
            <p className='mt-2 text-sm leading-relaxed text-slate10'>
              A device is requesting access to your Lali account.
            </p>
            <div className='mt-6 rounded-md border border-slate5 bg-slate4 p-4 text-sm'>
              <div className='mb-2 flex justify-between'>
                <span className='text-slate11'>Client:</span>
                <span className='font-medium text-slate12'>
                  {requestInfo.client_id || 'Unknown Device'}
                </span>
              </div>
              {requestInfo.scope && (
                <div className='flex justify-between'>
                  <span className='text-slate11'>Access:</span>
                  <span className='font-medium text-slate12'>
                    {requestInfo.scope}
                  </span>
                </div>
              )}
            </div>

            <div className='mt-6 flex flex-col gap-3'>
              <Button
                variant='primary'
                className='w-full'
                disabled={isProcessing}
                onClick={() => void handleAction('approve')}
              >
                <Check size={17} />
                {isProcessing ? 'Approving...' : 'Approve Access'}
              </Button>
              <Button
                variant='secondary'
                className='w-full'
                disabled={isProcessing}
                onClick={() => void handleAction('deny')}
              >
                <X size={17} />
                {isProcessing ? 'Denying...' : 'Deny'}
              </Button>
            </div>
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

        {stepLogs.length > 0 && (
          <div className='mt-5 rounded-lg border border-slate5 bg-slate2 p-3 text-xs text-slate10 font-mono space-y-1'>
            <div className='text-[10px] uppercase font-semibold text-slate11 tracking-wider'>
              Live Activity Trace
            </div>
            {stepLogs.map(log => (
              <div key={log.id} className='leading-tight text-slate11'>
                {log.message}
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  )
}
