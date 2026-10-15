import { Check, Copy, GitFork, Reply } from 'lucide-react'
import { useState } from 'react'
import {
  Message,
  MessageAction,
  MessageActions,
  MessageContent,
  MessageResponse,
} from '../../components/message'
import { EffectCard } from '../effects/EffectCard'
import { ActivityItem } from './ActivityItem'
import type { AssistantPhase } from './ThinkingIndicator'
import type { Effect } from './use-chat-session'

type AssistantMessageProps = {
  content: string
  thinkingContent?: string
  activities?: string[]
  effects?: Effect[]
  isComplete?: boolean
  active: boolean
  isLast: boolean
  onFork?: () => void
  onApprove?: () => void
  onReject?: () => void
  phase?: AssistantPhase
  onReply?: () => void
  failure?: string
}

export function AssistantMessage({
  content,
  thinkingContent,
  activities = [],
  effects = [],
  isComplete,
  active,
  isLast,
  onFork,
  onApprove,
  onReject,
  phase,
  onReply,
  failure,
}: AssistantMessageProps) {
  const [copied, setCopied] = useState(false)
  let displayContent = content
  let displayThinking = thinkingContent ?? ''

  const thinkMatch = displayContent.match(/<think>([\s\S]*?)<\/think>/)
  if (thinkMatch) {
    displayThinking = `${displayThinking}\n${thinkMatch[1]}`.trim()
    displayContent = displayContent.replace(thinkMatch[0], '')
  } else if (displayContent.includes('<think>')) {
    const [answer, thinking] = displayContent.split('<think>')
    displayContent = answer
    displayThinking = `${displayThinking}\n${thinking}`.trim()
  }

  const copy = async () => {
    await navigator.clipboard.writeText(displayContent)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <Message from='assistant' className={isLast ? 'min-h-[50svh]' : undefined}>
      <MessageContent>
        {(active ||
          phase === 'disconnected' ||
          activities.length > 0 ||
          displayThinking) && (
          <ActivityItem
            activities={activities}
            active={active}
            thinking={displayThinking}
            phase={phase ?? (active && displayContent ? 'writing' : undefined)}
          />
        )}
        {displayContent && (
          <div>
            <MessageResponse
              mode={active ? 'streaming' : 'static'}
              isAnimating={active}
            >
              {displayContent}
            </MessageResponse>
            {active && (
              <span
                aria-hidden='true'
                className='mt-1 inline-block h-4 w-0.5 bg-jade9 motion-safe:animate-pulse'
              />
            )}
          </div>
        )}
        {failure && (
          <p
            role='alert'
            className='rounded-xl border border-red6 bg-red2 px-4 py-3 text-sm text-red11'
          >
            {failure}
          </p>
        )}
        {effects.length > 0 && (
          <div className='mt-4 space-y-3'>
            {effects.map(effect => (
              <EffectCard
                key={effect.id}
                effect={effect}
                onApprove={onApprove}
                onReject={onReject}
              />
            ))}
          </div>
        )}
      </MessageContent>

      {displayContent && isComplete && (
        <MessageActions className='transition-opacity [@media(hover:hover)_and_(pointer:fine)]:opacity-0 group-hover/message:opacity-100 focus-within:opacity-100'>
          <MessageAction
            tooltip={copied ? 'Copied' : 'Copy response'}
            onClick={() => void copy()}
          >
            {copied ? <Check size={15} /> : <Copy size={15} />}
          </MessageAction>
          {onReply && (
            <MessageAction tooltip='Reply to response' onClick={onReply}>
              <Reply size={15} />
            </MessageAction>
          )}
          {onFork && (
            <MessageAction
              tooltip='Fork conversation from here'
              onClick={onFork}
            >
              <GitFork size={15} />
            </MessageAction>
          )}
        </MessageActions>
      )}
    </Message>
  )
}
