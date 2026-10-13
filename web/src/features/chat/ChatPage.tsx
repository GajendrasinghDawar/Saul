import { useNavigate } from '@tanstack/react-router'
import {
  type ChangeEvent,
  type FormEvent,
  useEffect,
  useRef,
  useState,
} from 'react'
import { toast } from 'sonner'
import {
  type ArtifactCapabilities,
  fileMimeType,
  getArtifactCapabilities,
  uploadFile,
} from '../../lib/api'
import { Composer, type StagedFile } from './Composer'
import { MessageTimeline } from './MessageTimeline'
import { useChatSession } from './use-chat-session'
import { useScrollToBottom } from './useScrollToBottom'

export function ChatPage({ sessionId }: { sessionId: string }) {
  const {
    messages,
    submitMessage,
    activeRunId,
    isCancelling,
    connectionStatus,
    stop,
    forkMessage,
  } = useChatSession(sessionId)
  const draftKey = `lali-draft-${sessionId}`
  const [draft, setDraft] = useState(
    () => sessionStorage.getItem(draftKey) || ''
  )
  useEffect(() => {
    sessionStorage.setItem(draftKey, draft)
  }, [draft, draftKey])
  const [stagedFiles, setStagedFiles] = useState<StagedFile[]>([])
  const [capabilities, setCapabilities] = useState<ArtifactCapabilities | null>(
    null
  )
  const [attachmentNotice, setAttachmentNotice] = useState(
    'Checking attachment availability...'
  )
  const [sending, setSending] = useState(false)
  const sendingRef = useRef(false)
  const stagedCountRef = useRef(0)
  useEffect(() => {
    let mounted = true
    void getArtifactCapabilities()
      .then(value => {
        if (!mounted) return
        setCapabilities(value)
        setAttachmentNotice(
          value.enabled
            ? ''
            : 'Attachments are unavailable: storage is disabled. You can still send text.'
        )
      })
      .catch((error: unknown) => {
        if (mounted)
          setAttachmentNotice(
            error instanceof Error
              ? error.message
              : 'Attachments are unavailable. You can still send text.'
          )
      })
    return () => {
      mounted = false
    }
  }, [])
  const fileInputRef = useRef<HTMLInputElement>(null)
  const { containerRef, isAtBottom, scrollToBottom } =
    useScrollToBottom<HTMLDivElement>([messages], !!activeRunId)

  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    if (!event.target.files?.length) return
    const selected = Array.from(event.target.files)
    event.target.value = ''
    if (sendingRef.current || !capabilities?.enabled) return
    const maxFiles = Math.min(4, capabilities.maxFilesPerMessage)
    if (stagedCountRef.current + selected.length > maxFiles) {
      toast.error(`Attach at most ${maxFiles} files per message.`)
      return
    }
    if (
      !capabilities.supportsImages &&
      selected.some(file => fileMimeType(file).startsWith('image/'))
    ) {
      toast.error(
        'This model does not accept images. Choose a text file or use an image-capable model.'
      )
      return
    }
    const invalid = selected.find(file => {
      const mime = fileMimeType(file)
      const limit = mime.startsWith('image/')
        ? Math.min(5 * 1024 * 1024, capabilities.maxFileBytes)
        : Math.min(64 * 1024, capabilities.maxTextFileBytes)
      return (
        file.size === 0 ||
        file.size > limit ||
        !capabilities.supportedMimeTypes.includes(mime)
      )
    })
    if (invalid) {
      toast.error(
        `${invalid.name}: use a nonempty PNG, JPEG or WebP up to 5 MiB, or a UTF-8 text file up to 64 KiB.`
      )
      return
    }
    stagedCountRef.current += selected.length
    const newFiles = selected.map(file => ({
      id: crypto.randomUUID(),
      file,
      uploading: true,
    }))
    setStagedFiles(current => [...current, ...newFiles])
    for (const staged of newFiles) {
      try {
        const attachment = await uploadFile(staged.file)
        setStagedFiles(current =>
          current.map(item =>
            item.file === staged.file
              ? { ...item, attachment, uploading: false }
              : item
          )
        )
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Upload failed'
        setStagedFiles(current =>
          current.map(item =>
            item.file === staged.file
              ? { ...item, error: message, uploading: false }
              : item
          )
        )
      }
    }
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    if (
      sendingRef.current ||
      stagedFiles.some(file => file.uploading || file.error)
    )
      return
    const attachments = stagedFiles.flatMap(file =>
      file.attachment ? [file.attachment] : []
    )
    if (!draft.trim() && attachments.length === 0) return
    sendingRef.current = true
    setSending(true)
    const sent = await submitMessage(
      draft.trim(),
      attachments,
      activeRunId ? 'steer' : undefined
    )
    sendingRef.current = false
    setSending(false)
    if (sent) {
      setDraft('')
      setStagedFiles([])
      stagedCountRef.current = 0
    }
    setTimeout(scrollToBottom, 50)
  }

  const navigate = useNavigate()

  const handleFork = async (messageId: string) => {
    try {
      const newConvId = await forkMessage(messageId)
      void navigate({ to: `/chat/${newConvId}` })
    } catch {
      toast.error('Failed to fork conversation.')
    }
  }

  return (
    <div className='flex size-full min-h-0 flex-col'>
      <MessageTimeline
        messages={messages}
        activeRunId={activeRunId}
        containerRef={containerRef}
        isAtBottom={isAtBottom}
        scrollToBottom={scrollToBottom}
        onSuggestion={setDraft}
        onFork={handleFork}
        onSubmitMessage={text => void submitMessage(text)}
      />
      <Composer
        draft={draft}
        setDraft={setDraft}
        stagedFiles={stagedFiles}
        sending={sending}
        capabilities={capabilities}
        attachmentNotice={attachmentNotice}
        fileInputRef={fileInputRef}
        onFiles={event => void handleFileChange(event)}
        onRemoveFile={file => {
          if (sendingRef.current) return
          stagedCountRef.current = Math.max(0, stagedCountRef.current - 1)
          setStagedFiles(current => current.filter(item => item.file !== file))
        }}
        onSubmit={event => void handleSubmit(event)}
        onStop={() => void stop()}
        activeRunId={activeRunId}
        isCancelling={isCancelling}
        connectionStatus={connectionStatus}
      />
    </div>
  )
}
