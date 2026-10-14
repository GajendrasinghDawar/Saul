import { useNavigate } from '@tanstack/react-router'
import { type FormEvent, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import {
  type ArtifactCapabilities,
  fileMimeType,
  getArtifactCapabilities,
  uploadFile,
} from '../../lib/api'
import { Composer } from './Composer'
import { useChatDraft } from './chat-drafts'
import { HistorySource } from './HistorySource'
import { MessageTimeline } from './MessageTimeline'
import { useChatSession } from './use-chat-session'
import { useScrollToBottom } from './useScrollToBottom'

export function ChatPage({
  sessionId,
  targetEntryId,
}: {
  sessionId: string
  targetEntryId?: string
}) {
  return (
    <SessionChatPage
      key={sessionId}
      sessionId={sessionId}
      targetEntryId={targetEntryId}
    />
  )
}

function SessionChatPage({
  sessionId,
  targetEntryId,
}: {
  sessionId: string
  targetEntryId?: string
}) {
  const {
    draft: draftState,
    text: draft,
    files: stagedFiles,
    sending,
    reply,
  } = useChatDraft(sessionId)
  const setDraft = draftState.setText
  const setStagedFiles = draftState.setFiles
  const {
    messages,
    submitMessage,
    activeRunId,
    connectionStatus,
    forkMessage,
    canQueue,
    retryMessage,
    deleteMessage,
    resolvedConversationId,
  } = useChatSession(sessionId)
  const [capabilities, setCapabilities] = useState<ArtifactCapabilities | null>(
    null
  )
  const [attachmentNotice, setAttachmentNotice] = useState(
    'Checking attachment availability...'
  )
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

  const handleFileChange = async (selected: File[]) => {
    if (!selected.length) return
    if (draftState.snapshot().sending || !capabilities?.enabled) return
    const maxFiles = Math.min(4, capabilities.maxFilesPerMessage)
    if (draftState.snapshot().files.length + selected.length > maxFiles) {
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
    const submitted = draftState.snapshot()
    if (
      submitted.sending ||
      submitted.files.some(file => file.uploading || file.error)
    )
      return
    const attachments = stagedFiles.flatMap(file =>
      file.attachment ? [file.attachment] : []
    )
    if (!draft.trim() && attachments.length === 0) return
    draftState.setSending(true)
    const sent = await submitMessage(
      draft.trim(),
      attachments,
      submitted.reply?.entryId
    )
    draftState.setSending(false)
    if (sent) draftState.delivered(submitted.revision, submitted.files)
    else
      toast.error(
        'Could not save this message on the device. Keep your draft and try again.'
      )
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
      {targetEntryId &&
        resolvedConversationId &&
        connectionStatus === 'connected' &&
        !messages.some(message =>
          (message.entryIds ?? [message.requestId]).includes(targetEntryId)
        ) && (
          <HistorySource
            key={`${resolvedConversationId}:${targetEntryId}`}
            conversationId={resolvedConversationId}
            entryId={targetEntryId}
            onReply={draftState.setReply}
          />
        )}
      <MessageTimeline
        messages={messages}
        activeRunId={activeRunId}
        containerRef={containerRef}
        isAtBottom={isAtBottom}
        scrollToBottom={scrollToBottom}
        onSuggestion={setDraft}
        onFork={handleFork}
        onReply={message => {
          draftState.setReply({
            entryId: message.requestId,
            role: message.role,
            text: message.content.slice(0, 2000),
          })
          document
            .querySelector<HTMLTextAreaElement>(
              'textarea[aria-label="Message"]'
            )
            ?.focus()
        }}
        targetEntryId={targetEntryId}
        connected={connectionStatus === 'connected'}
        onRetryMessage={id => void retryMessage(id)}
        onDeleteMessage={id => void deleteMessage(id)}
      />
      <Composer
        draft={draft}
        setDraft={setDraft}
        stagedFiles={stagedFiles}
        sending={sending}
        capabilities={capabilities}
        attachmentNotice={attachmentNotice}
        fileInputRef={fileInputRef}
        onFilesSelected={files => void handleFileChange(files)}
        onRemoveFile={file => {
          if (draftState.snapshot().sending) return
          setStagedFiles(current => current.filter(item => item.file !== file))
        }}
        onSubmit={event => void handleSubmit(event)}
        activeRunId={activeRunId}
        connectionStatus={connectionStatus}
        canQueue={canQueue}
        reply={reply}
        onRemoveReply={() => draftState.setReply(null)}
      />
    </div>
  )
}
