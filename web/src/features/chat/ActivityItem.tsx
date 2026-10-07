import { ChevronDown, Sparkles } from 'lucide-react'
import { useState } from 'react'
import { MessageResponse } from '../../components/message'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '../../components/ui/Collapsible'
import { cn } from '../../lib/cn'

export function ActivityItem({
  activities,
  active,
  thinking,
}: {
  activities: string[]
  active: boolean
  thinking?: string
}) {
  const [manuallyOpen, setManuallyOpen] = useState(false)
  let latest = 'Thinking...'
  if (thinking) {
    latest = 'Thinking...'
  } else if (activities.length > 0) {
    latest = activities.at(-1) as string
  }

  const hasContent = activities.length > 0 || Boolean(thinking)

  const open = active && thinking ? true : manuallyOpen

  return (
    <Collapsible open={open} onOpenChange={setManuallyOpen} className='mb-3'>
      <CollapsibleTrigger
        className='flex items-center gap-2 rounded text-sm font-medium text-slate10 hover:text-slate12 disabled:opacity-50'
        disabled={!hasContent}
      >
        <Sparkles size={14} className='text-jade10' />
        <span
          className={cn(
            active &&
              'bg-gradient-to-r from-slate10 via-slate12 to-slate10 bg-[length:200%_auto] bg-clip-text text-transparent animate-[shimmer_2s_linear_infinite]'
          )}
        >
          {active
            ? latest
            : thinking
              ? 'Thought Process'
              : `Activity (${activities.length})`}
        </span>
        {hasContent && (
          <ChevronDown
            size={14}
            className={cn('transition-transform', open && 'rotate-180')}
          />
        )}
      </CollapsibleTrigger>
      {hasContent && (
        <CollapsibleContent className='ml-2 mt-2 space-y-1 border-l border-slate5 pl-5 text-xs text-slate9'>
          {activities.map((activity, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: order is fixed
            <div key={`${index}-${activity}`}>{activity}</div>
          ))}
          {thinking && (
            <MessageResponse
              className='mt-2 text-xs opacity-80'
              mode={active ? 'streaming' : 'static'}
              isAnimating={active}
            >
              {thinking}
            </MessageResponse>
          )}
        </CollapsibleContent>
      )}
    </Collapsible>
  )
}
