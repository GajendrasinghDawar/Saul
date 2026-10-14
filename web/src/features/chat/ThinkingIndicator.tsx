import { Check, Circle, Pencil, Wrench } from 'lucide-react'

export type AssistantPhase =
  | 'waiting'
  | 'thinking'
  | 'tool'
  | 'writing'
  | 'complete'
  | 'disconnected'

const labels: Record<AssistantPhase, string> = {
  waiting: 'Waiting for model',
  thinking: 'Reported thinking',
  tool: 'Tool activity',
  writing: 'Writing answer',
  complete: 'Complete',
  disconnected: 'Connection lost · last received state',
}

export function ThinkingIndicator({ phase }: { phase: AssistantPhase }) {
  const Icon =
    phase === 'complete'
      ? Check
      : phase === 'tool'
        ? Wrench
        : phase === 'writing'
          ? Pencil
          : Circle
  return (
    <span
      className='inline-flex items-center gap-2 text-xs font-medium text-slate11'
      role='status'
    >
      <span
        aria-hidden='true'
        className={`relative inline-flex size-5 items-center justify-center ${phase === 'complete' || phase === 'disconnected' ? 'text-slate10' : 'text-jade10'}`}
      >
        {(phase === 'waiting' || phase === 'thinking') && (
          <span className='absolute inset-0 rounded-full border border-jade7 motion-safe:animate-pulse' />
        )}
        <Icon size={12} />
      </span>
      {labels[phase]}
    </span>
  )
}
