import { Check, Copy, GitFork } from 'lucide-react'
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
        {(active || activities.length > 0 || displayThinking) && (
          <ActivityItem
            activities={activities}
            active={active}
            thinking={displayThinking}
          />
        )}
        {displayContent && (
          <MessageResponse
            mode={active ? 'streaming' : 'static'}
            isAnimating={active}
          >
            {displayContent}
          </MessageResponse>
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
        <MessageActions className='opacity-0 transition-opacity group-hover/message:opacity-100 focus-within:opacity-100'>
          <MessageAction
            tooltip={copied ? 'Copied' : 'Copy response'}
            onClick={() => void copy()}
          >
            {copied ? <Check size={15} /> : <Copy size={15} />}
          </MessageAction>
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
