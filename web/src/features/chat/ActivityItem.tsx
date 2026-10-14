import { ChevronDown } from 'lucide-react'
import { useState } from 'react'
import { MessageResponse } from '../../components/message'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '../../components/ui/Collapsible'
import { cn } from '../../lib/cn'
import { type AssistantPhase, ThinkingIndicator } from './ThinkingIndicator'

export function ActivityItem({
  activities,
  active,
  thinking,
  phase,
}: {
  activities: string[]
  active: boolean
  thinking?: string
  phase?: AssistantPhase
}) {
  const [manuallyOpen, setManuallyOpen] = useState(false)
  const currentPhase =
    phase === 'disconnected'
      ? phase
      : !active
        ? 'complete'
        : (phase ??
          (thinking ? 'thinking' : activities.length ? 'tool' : 'waiting'))

  const hasContent = activities.length > 0 || Boolean(thinking)

  const open = manuallyOpen

  return (
    <Collapsible open={open} onOpenChange={setManuallyOpen} className='mb-3'>
      <ThinkingIndicator phase={currentPhase} />
      {hasContent && (
        <CollapsibleTrigger
          className='mt-1 flex min-h-11 items-center gap-2 rounded-lg px-2 text-sm font-medium text-slate11 hover:bg-slate3 hover:text-slate12 focus-visible:outline-2 focus-visible:outline-jade8 disabled:opacity-50'
          disabled={!hasContent}
        >
          <span>
            {hasContent
              ? `Inspect reported work${activities.length ? ` (${activities.length})` : ''}`
              : 'No work reported yet'}
          </span>
          {hasContent && (
            <ChevronDown
              size={14}
              className={cn(
                'transition-transform motion-reduce:transition-none',
                open && 'rotate-180'
              )}
            />
          )}
        </CollapsibleTrigger>
      )}
      {hasContent && (
        <CollapsibleContent className='ml-2 mt-2 space-y-2 border-l border-slate6 pl-5 text-xs text-slate11'>
          {activities.map((activity, index) => (
            <pre
              className='whitespace-pre-wrap break-words font-sans'
              // biome-ignore lint/suspicious/noArrayIndexKey: append-only stateless work rows can contain identical output
              key={`${index}-${activity}`}
            >
              {activity}
            </pre>
          ))}
          {thinking && (
            <div>
              <p className='mt-3 font-medium text-slate11'>
                Model-reported thinking
              </p>
              <MessageResponse
                className='mt-2 text-xs opacity-80'
                mode={active ? 'streaming' : 'static'}
                isAnimating={active}
              >
                {thinking}
              </MessageResponse>
            </div>
          )}
        </CollapsibleContent>
      )}
    </Collapsible>
  )
}
