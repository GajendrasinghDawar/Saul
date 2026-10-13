import { Download, GitFork } from 'lucide-react'
import {
  Message,
  MessageAction,
  MessageActions,
  MessageContent,
} from '../../components/message'
import type { Attachment } from '../../lib/api'

export function UserMessage({
  content,
  attachments = [],
  status,
  onFork,
}: {
  content: string
  attachments?: Attachment[]
  status?: 'sending' | 'delivered' | 'failed'
  onFork?: () => void
}) {
  return (
    <Message from='user'>
      <MessageContent>
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
          <p role='status' className='mt-2 text-xs text-crimson11'>
            Delivery not confirmed. Your draft and attachments are preserved.
            Check the transcript before sending again.
          </p>
        )}
        {status === 'sending' && (
          <p role='status' className='mt-2 text-xs text-slate10'>
            Sending...
          </p>
        )}
      </MessageContent>
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
