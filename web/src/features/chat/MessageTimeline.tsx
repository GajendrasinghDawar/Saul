import { ChevronDown } from 'lucide-react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { type RefObject, useEffect, useRef } from 'react'
import { ScrollArea } from '../../components/ui/ScrollArea'
import { AssistantMessage } from './AssistantMessage'
import { EmptyChat } from './EmptyChat'
import { UserMessage } from './UserMessage'
import type { Message } from './use-chat-session'

type MessageTimelineProps = {
  messages: Message[]
  activeRunId: string | null
  containerRef: RefObject<HTMLDivElement | null>
  isAtBottom: boolean
  scrollToBottom: () => void
  onSuggestion: (text: string) => void
  onFork?: (messageId: string) => void
  onReply?: (message: Message) => void
  onRetryMessage?: (deliveryId: string) => void
  onDeleteMessage?: (deliveryId: string) => void
  targetEntryId?: string
  connected?: boolean
}

export function MessageTimeline({
  messages,
  activeRunId,
  containerRef,
  isAtBottom,
  scrollToBottom,
  onSuggestion,
  onFork,
  onReply,
  onRetryMessage,
  onDeleteMessage,
  targetEntryId,
  connected = true,
}: MessageTimelineProps) {
  const reduceMotion = useReducedMotion()
  const jumped = useRef('')
  const targetAvailable = messages.some(message =>
    (message.entryIds ?? [message.requestId]).includes(targetEntryId ?? '')
  )
  useEffect(() => {
    if (!targetAvailable || !targetEntryId || jumped.current === targetEntryId)
      return
    const target = document.getElementById(`entry-${targetEntryId}`)
    if (target) {
      target.scrollIntoView({
        block: 'center',
        behavior: reduceMotion ? 'instant' : 'smooth',
      })
      jumped.current = targetEntryId
    }
  }, [targetEntryId, targetAvailable, reduceMotion])
  return (
    <div className='relative min-h-0 flex-1'>
      <ScrollArea
        data-chat-scroll-area
        viewportRef={containerRef}
        className='size-full px-1 sm:px-2 md:px-0'
      >
        <div className='mx-auto w-full max-w-4xl'>
          <div className='flex flex-col gap-4 px-2 py-4 md:gap-6 md:px-4'>
            {messages.length === 0 && <EmptyChat onSelect={onSuggestion} />}
            {messages.map((message, index) => (
              <div
                key={`${message.role}-${message.requestId}`}
                id={`entry-${message.requestId}`}
                className={
                  targetEntryId &&
                  (message.entryIds ?? [message.requestId]).includes(
                    targetEntryId
                  )
                    ? 'rounded-xl ring-1 ring-jade8 ring-offset-4 ring-offset-slate2'
                    : undefined
                }
              >
                {message.entryIds
                  ?.filter(id => id !== message.requestId)
                  .map(id => (
                    <span key={id} id={`entry-${id}`} />
                  ))}
                {message.role === 'user' ? (
                  <UserMessage
                    content={message.content}
                    attachments={message.attachments}
                    status={message.status}
                    reply={message.reply}
                    onRetry={
                      message.status === 'failed' && message.deliveryId
                        ? () => {
                            if (message.deliveryId)
                              onRetryMessage?.(message.deliveryId)
                          }
                        : undefined
                    }
                    onDelete={
                      message.status === 'failed' && message.deliveryId
                        ? () => {
                            if (message.deliveryId)
                              onDeleteMessage?.(message.deliveryId)
                          }
                        : undefined
                    }
                    onReply={
                      message.status === 'delivered' &&
                      /^\d+$/.test(message.requestId)
                        ? () => onReply?.(message)
                        : undefined
                    }
                    onFork={
                      message.status === 'delivered'
                        ? () => onFork?.(message.requestId)
                        : undefined
                    }
                  />
                ) : (
                  <AssistantMessage
                    content={message.content}
                    thinkingContent={message.thinkingContent}
                    activities={message.activities}
                    effects={message.effects}
                    isComplete={message.isComplete}
                    failure={message.failure}
                    active={connected && activeRunId === message.requestId}
                    isLast={index === messages.length - 1}
                    onFork={() => onFork?.(message.requestId)}
                    phase={
                      !connected && activeRunId === message.requestId
                        ? 'disconnected'
                        : message.phase
                    }
                    onReply={
                      message.isComplete && message.replyEntryId
                        ? () => {
                            if (message.replyEntryId)
                              onReply?.({
                                ...message,
                                requestId: message.replyEntryId,
                                content: message.replyText ?? message.content,
                              })
                          }
                        : undefined
                    }
                  />
                )}
              </div>
            ))}
          </div>
        </div>
      </ScrollArea>
      <AnimatePresence initial={false}>
        {!isAtBottom && (
          <motion.button
            key='scroll-to-bottom'
            type='button'
            onClick={scrollToBottom}
            aria-label='Scroll to bottom'
            initial={{ opacity: 0, y: reduceMotion ? 0 : 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: reduceMotion ? 0 : 8 }}
            transition={{ duration: reduceMotion ? 0 : 0.18, ease: 'easeOut' }}
            className='absolute bottom-4 right-4 z-10 inline-flex size-10 items-center justify-center rounded-full border border-slate6 bg-slate3 text-slate11 shadow-3 backdrop-blur-sm hover:bg-slate4 focus-visible:ring-2 focus-visible:ring-slate8'
          >
            <ChevronDown className='size-5' />
          </motion.button>
        )}
      </AnimatePresence>
    </div>
  )
}
