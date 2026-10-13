import { Paperclip, Send, X } from 'lucide-react'
import { type FormEvent, type KeyboardEvent, type RefObject, useEffect, useRef, useState } from 'react'
import { Button } from '../../components/ui/Button'
import { Textarea } from '../../components/ui/Textarea'
import type { ArtifactCapabilities, Attachment } from '../../lib/api'

export type StagedFile = {
  id: string
  file: File
  attachment?: Attachment
  error?: string
  uploading: boolean
}

export type ComposerReply = { entryId: string; role: string; text: string }

type ComposerProps = {
  draft: string
  setDraft: (value: string) => void
  stagedFiles: StagedFile[]
  sending: boolean
  capabilities: ArtifactCapabilities | null
  attachmentNotice: string
  fileInputRef: RefObject<HTMLInputElement | null>
  onFilesSelected: (files: File[]) => void
  onRemoveFile: (file: File) => void
  onSubmit: (event: FormEvent) => void
  activeRunId: string | null
  connectionStatus: string
  reply?: ComposerReply | null
  onRemoveReply?: () => void
}

function FilePreview({ file }: { file: File }) {
  const [preview, setPreview] = useState<{ file: File; url: string } | null>(null)
  useEffect(() => {
    if (!file.type.startsWith('image/')) return
    const url = URL.createObjectURL(file)
    setPreview({ file, url })
    return () => URL.revokeObjectURL(url)
  }, [file])
  return preview?.file === file ? (
    <img src={preview.url} alt='' className='size-12 shrink-0 rounded-lg object-cover' />
  ) : null
}

export function Composer({ draft, setDraft, stagedFiles, sending, capabilities,
  attachmentNotice, fileInputRef, onFilesSelected, onRemoveFile, onSubmit,
  activeRunId, connectionStatus, reply, onRemoveReply }: ComposerProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const uploading = stagedFiles.some(file => file.uploading)
  const hasUploadError = stagedFiles.some(file => file.error)
  const canSend = (draft.trim().length > 0 || stagedFiles.some(file => file.attachment)) &&
    !sending && connectionStatus === 'connected' && !uploading && !hasUploadError
  // biome-ignore lint/correctness/useExhaustiveDependencies: resize after draft updates the DOM.
  useEffect(() => {
    const textarea = textareaRef.current
    if (textarea) {
      textarea.style.height = '0px'
      textarea.style.height = `${Math.max(72, Math.min(textarea.scrollHeight, 240))}px`
    }
  }, [draft])
  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229) {
      event.preventDefault()
      if (canSend) event.currentTarget.form?.requestSubmit()
    }
  }
  const status = connectionStatus !== 'connected'
    ? connectionStatus === 'connecting' ? 'Connecting…' : 'Offline — reconnecting…'
    : uploading ? 'Uploading attachments…' : hasUploadError ? 'Remove failed attachments to send'
    : sending ? 'Sending…' : activeRunId ? 'Saul is responding' : 'Ready to send'

  return (
    <div className='w-full bg-slate2 px-4 pb-3 pt-3 md:px-2 lg:px-0'>
      <form onSubmit={event => { if (!canSend) { event.preventDefault(); return }; onSubmit(event) }}
        onDragOver={event => { if (event.dataTransfer.types.includes('Files')) event.preventDefault() }}
        onDrop={event => {
          if (!event.dataTransfer.types.includes('Files')) return
          event.preventDefault()
          onFilesSelected(Array.from(event.dataTransfer.files))
        }}
        onPaste={event => {
          const files = Array.from(event.clipboardData.files)
          if (!files.length) return
          event.preventDefault()
          onFilesSelected(files)
        }}
        className='mx-auto w-full md:max-w-2xl lg:max-w-3xl'>
        <div className='overflow-hidden rounded-2xl border border-slate6 bg-slate3 shadow-1 transition-colors focus-within:border-jade8 motion-reduce:transition-none'>
          {reply && (
            <div className='mx-4 mt-4 flex items-center gap-3 rounded-lg border-l-2 border-jade8 bg-slate4 px-3 py-2 text-sm'>
              <div className='min-w-0 flex-1'><p className='text-xs font-medium text-jade11'>Replying to {reply.role}</p><p className='line-clamp-2 text-slate11'>{reply.text}</p></div>
              {onRemoveReply && <Button size='icon' variant='ghost' className='size-11 shrink-0' aria-label='Remove reply' onClick={onRemoveReply}><X size={16} /></Button>}
            </div>
          )}
          {stagedFiles.length > 0 && <div className='flex flex-wrap gap-2 px-4 pt-4'>
            {stagedFiles.map(file => <div key={file.id} className={`flex max-w-full items-center gap-2 rounded-xl border bg-slate4 p-2 text-xs ${file.error ? 'border-red8 text-red11' : 'border-slate6 text-slate11'}`}>
              <FilePreview file={file.file} />
              <div className='min-w-0'><p className='max-w-48 truncate'>{file.file.name}</p><p>{file.error ? `Upload failed: ${file.error}` : file.uploading ? 'Uploading…' : file.attachment ? 'Attached' : 'Waiting to upload'}</p></div>
              <Button size='icon' variant='ghost' className='size-11 shrink-0' disabled={sending} onClick={() => onRemoveFile(file.file)} aria-label={`Remove ${file.file.name}`}><X size={16} /></Button>
            </div>)}
          </div>}
          {(attachmentNotice || !capabilities?.enabled || !capabilities.supportsImages) && <p role='status' className='px-4 pt-3 text-xs text-slate11'>{attachmentNotice || (!capabilities ? 'Checking attachment availability…' : !capabilities.enabled ? 'Attachments unavailable. You can still send text.' : 'This model accepts text files only; images are unavailable.')}</p>}
          <div className='px-4 pb-2 pt-4'>
            <Textarea ref={textareaRef} value={draft} disabled={sending} onChange={event => setDraft(event.target.value)} onKeyDown={handleKeyDown} placeholder='Message Saul…' rows={2} className='min-h-[72px] max-h-[240px] overflow-y-auto py-1 text-base leading-7' aria-label='Message' />
          </div>
          <div className='flex items-center justify-between gap-3 border-t border-slate5 px-3 py-2'>
            <div className='flex min-w-0 items-center gap-2'>
              <Button size='icon' variant='ghost' className='size-11 shrink-0' onClick={() => fileInputRef.current?.click()} aria-label='Attach files' disabled={sending || !capabilities?.enabled || stagedFiles.length >= Math.min(4, capabilities.maxFilesPerMessage)} title={attachmentNotice || 'Attach images or text files'}><Paperclip size={18} /></Button>
              <span className='text-xs text-slate11' role='status'>{status}</span>
            </div>
            <input ref={fileInputRef} className='hidden' type='file' multiple accept={capabilities?.supportedMimeTypes.filter(mime => capabilities.supportsImages || !mime.startsWith('image/')).join(',')} onChange={event => { onFilesSelected(Array.from(event.currentTarget.files ?? [])); event.currentTarget.value = '' }} />
            <Button size='icon' variant='secondary' className='size-11 shrink-0 border-jade7 bg-jade3 text-jade11 hover:bg-jade4' type='submit' disabled={!canSend} aria-label='Send message'><Send size={18} /></Button>
          </div>
        </div>
        <p className='hidden px-4 pt-2 text-xs text-slate9 md:block'>Enter to send · Shift + Enter for a new line</p>
      </form>
    </div>
  )
}
