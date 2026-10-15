import { Check, ChevronDown, ShieldAlert, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Button } from '../../components/ui/Button'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '../../components/ui/Collapsible'
import {
  type Approval,
  approveEffect,
  getApproval,
  rejectEffect,
} from '../../lib/api'
import { cn } from '../../lib/cn'
import type { Effect } from '../chat/use-chat-session'

type EffectStatus = NonNullable<Effect['status']>

const statusStyles: Record<EffectStatus, string> = {
  pending: 'bg-amber2 text-amber11',
  approved: 'bg-jade2 text-jade11',
  running: 'bg-jade2 text-jade11',
  executed: 'bg-jade2 text-jade11',
  failed: 'bg-red2 text-red11',
  rejected: 'bg-slate4 text-slate11',
  expired: 'bg-slate4 text-slate11',
  interrupted: 'bg-slate4 text-slate11',
  unknown: 'bg-slate4 text-slate11',
}

export function EffectCard({
  effect,
  onApprove,
  onReject,
}: {
  effect: Effect
  onApprove?: () => void
  onReject?: () => void
}) {
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(false)
  const [approval, setApproval] = useState<Approval | null>(null)
  const [error, setError] = useState('')
  const generation = useRef(0)
  // biome-ignore lint/correctness/useExhaustiveDependencies: A streamed decision invalidates the previously fetched approval state.
  useEffect(() => {
    const version = ++generation.current
    setApproval(null)
    setLoading(false)
    setError('')
    void getApproval(effect.id)
      .then(value => {
        if (generation.current === version) setApproval(value)
      })
      .catch(() => {
        if (generation.current === version)
          setError('Approval state is unavailable.')
      })
    return () => {
      generation.current++
    }
  }, [effect.id, effect.status])
  const status = approval?.id === effect.id ? approval.status : 'unknown'
  const run = async (action: 'approve' | 'reject') => {
    if (loading || status !== 'pending') return
    const version = generation.current
    setLoading(true)
    setError('')
    try {
      if (action === 'approve') {
        await approveEffect(effect.id)
        onApprove?.()
      } else {
        await rejectEffect(effect.id)
        onReject?.()
      }
    } catch (cause) {
      if (generation.current === version)
        setError(
          cause instanceof Error
            ? cause.message
            : 'Decision could not be confirmed.'
        )
    } finally {
      try {
        const value = await getApproval(effect.id)
        if (generation.current === version) setApproval(value)
      } catch {
        if (generation.current === version) {
          setApproval(null)
          setError('Approval state is unavailable.')
        }
      }
      if (generation.current === version) setLoading(false)
    }
  }
  return (
    <section className='rounded-xl border border-slate4 bg-slate2 px-4 py-4 shadow-2'>
      <div className='flex flex-wrap items-center justify-between gap-2'>
        <div className='flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate10'>
          <ShieldAlert size={15} />
          {effect.type?.replaceAll('_', ' ') || 'Effect'}
        </div>
        <span
          className={cn(
            'rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
            status === 'consumed' ? statusStyles.approved : statusStyles[status]
          )}
        >
          {status}
        </span>
      </div>
      <div className='mt-2 text-sm text-slate11'>
        {approval?.action || effect.summary || 'Review this requested action.'}
      </div>
      {error && (
        <p role='status' className='mt-2 text-xs text-red11'>
          {error}
        </p>
      )}
      {approval && (
        <p className='mt-2 text-xs text-slate10'>
          {status === 'interrupted'
            ? 'This approval wait was cancelled.'
            : 'Your decision automatically continues the waiting agent in this chat.'}
        </p>
      )}
      {status === 'pending' && (
        <div className='mt-4 flex gap-2'>
          <Button
            size='small'
            variant='primary'
            disabled={loading}
            onClick={() => void run('approve')}
          >
            <Check size={15} />
            Approve
          </Button>
          <Button
            size='small'
            variant='ghost'
            disabled={loading}
            onClick={() => void run('reject')}
          >
            <X size={15} />
            Reject
          </Button>
        </div>
      )}
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger className='mt-4 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate10 hover:text-slate12'>
          <ChevronDown
            size={14}
            className={cn('transition-transform', open && 'rotate-180')}
          />
          Details
        </CollapsibleTrigger>
        <CollapsibleContent className='mt-3 space-y-3 text-xs'>
          <div>
            <div className='mb-1 uppercase tracking-wide text-slate9'>
              Requested action
            </div>
            <pre className='whitespace-pre-wrap break-words rounded-md bg-slate1 p-3 text-slate11'>
              {approval?.detail ?? 'Details are unavailable.'}
            </pre>
          </div>
          {effect.digest && (
            <div>
              <div className='mb-1 uppercase tracking-wide text-slate9'>
                Digest
              </div>
              <code className='break-all text-slate10'>{effect.digest}</code>
            </div>
          )}
        </CollapsibleContent>
      </Collapsible>
    </section>
  )
}
