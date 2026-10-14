import { Download, GitFork, Reply } from 'lucide-react'
import {
  Message,
  MessageAction,
  MessageActions,
  MessageContent,
} from '../../components/message'
import type { Attachment } from '../../lib/api'
import type { ComposerReply } from './Composer'

export function UserMessage({
  content,
  attachments = [],
  status,
  onFork,
  onReply,
  onRetry,
  onDelete,
  reply,
}: {
  content: string
  attachments?: Attachment[]
  status?: 'sending' | 'waiting' | 'delivered' | 'failed'
  onFork?: () => void
  onReply?: () => void
  onRetry?: () => void
  onDelete?: () => void
  reply?: ComposerReply
}) {
  return (
    <Message from='user'>
      <MessageContent>
        {reply && (
          <a
            href={`?entry=${encodeURIComponent(reply.entryId)}`}
            className='mb-3 block rounded-lg border-l-2 border-jade8 bg-slate3 px-3 py-2 text-xs text-slate11'
          >
            <span className='block font-medium text-jade11'>
              Reply to {reply.role}
            </span>
            <span className='line-clamp-2'>{reply.text}</span>
          </a>
        )}
        {content}
        {attachments.length > 0 && (
          <div className='mt-2 flex flex-wrap gap-2'>
            {attachments.map(file => (
              <a
                key={file.id}
                href={`/api/artifacts/${encodeURIComponent(file.id)}`}
                download={file.name}
                className='flex max-w-full items-center gap-3 rounded-md border border-slate6 bg-slate3 px-3 py-2 text-sm text-slate12 hover:bg-slate4'
              >
                <Download size={16} className='shrink-0 text-slate10' />
                <span className='min-w-0'>
                  <span className='block truncate'>{file.name}</span>
                  <span className='block text-xs text-slate10'>
                    {file.size < 1024
                      ? `${file.size} B`
                      : file.size < 1024 * 1024
                        ? `${(file.size / 1024).toFixed(1)} KiB`
                        : `${(file.size / (1024 * 1024)).toFixed(1)} MiB`}
                  </span>
                </span>
              </a>
            ))}
          </div>
        )}
        {status === 'failed' && (
          <div
            role='status'
            className='mt-2 flex items-center gap-3 text-xs text-crimson11'
          >
            <span>Couldn’t send.</span>
            {onRetry && (
              <button
                type='button'
                className='font-medium text-jade11 hover:underline'
                onClick={onRetry}
              >
                Retry
              </button>
            )}
            {onDelete && (
              <button
                type='button'
                className='text-slate11 hover:underline'
                onClick={onDelete}
              >
                Delete
              </button>
            )}
          </div>
        )}
        {status === 'sending' && (
          <p role='status' className='mt-2 text-xs text-slate10'>
            Sending…
          </p>
        )}
        {status === 'waiting' && (
          <p role='status' className='mt-2 text-xs text-slate10'>
            Waiting for connection…
          </p>
        )}
      </MessageContent>
      {(onFork || onReply) && (
        <MessageActions className='transition-opacity [@media(hover:hover)_and_(pointer:fine)]:opacity-0 group-hover/message:opacity-100 focus-within:opacity-100'>
          {onReply && (
            <MessageAction tooltip='Reply to message' onClick={onReply}>
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
