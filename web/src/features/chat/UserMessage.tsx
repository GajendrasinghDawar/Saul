import { GitFork } from 'lucide-react'
import {
  Message,
  MessageAction,
  MessageActions,
  MessageContent,
} from '../../components/message'

export function UserMessage({
  content,
  onFork,
}: {
  content: string
  onFork?: () => void
}) {
  return (
    <Message from='user'>
      <MessageContent>{content}</MessageContent>
      {onFork && (
        <MessageActions className='opacity-0 transition-opacity group-hover/message:opacity-100 focus-within:opacity-100'>
          <MessageAction tooltip='Fork conversation from here' onClick={onFork}>
            <GitFork size={15} />
          </MessageAction>
        </MessageActions>
      )}
    </Message>
  )
}
