import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { uploadFile } from "../../lib/api";
import { Composer, type StagedFile } from "./Composer";
import { MessageTimeline } from "./MessageTimeline";
import { useChatSession } from "./use-chat-session";
import { useScrollToBottom } from "./useScrollToBottom";

export function ChatPage({ sessionId }: { sessionId: string }) {
  const { messages, submitMessage, activeRunId, isCancelling, connectionStatus, stop } = useChatSession(sessionId);
  const draftKey = `lali-draft-${sessionId}`;
  const [draft, setDraft] = useState(() => sessionStorage.getItem(draftKey) || "");
  useEffect(() => {
    sessionStorage.setItem(draftKey, draft);
  }, [draft, draftKey]);
  const [stagedFiles, setStagedFiles] = useState<StagedFile[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { containerRef, isAtBottom, scrollToBottom } = useScrollToBottom<HTMLDivElement>([messages], !!activeRunId);

  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    if (!event.target.files?.length) return;
    const newFiles = Array.from(event.target.files).map(file => ({ file, uploading: true }));
    setStagedFiles(current => [...current, ...newFiles]);
    for (const staged of newFiles) {
      try {
        const id = await uploadFile(sessionId, staged.file);
        setStagedFiles(current => current.map(item => item.file === staged.file ? { ...item, id, uploading: false } : item));
      } catch (error) {
        const message = error instanceof Error ? error.message : "Upload failed";
        setStagedFiles(current => current.map(item => item.file === staged.file ? { ...item, error: message, uploading: false } : item));
      }
    }
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (stagedFiles.some(file => file.uploading || file.error)) return;
    const attachmentIds = stagedFiles.flatMap(file => file.id ? [file.id] : []);
    if (!draft.trim() && attachmentIds.length === 0) return;
    void submitMessage(draft.trim(), attachmentIds, activeRunId ? "steer" : undefined);
    setDraft("");
    setStagedFiles([]);
    setTimeout(scrollToBottom, 50);
  };

  return <div className="flex size-full min-h-0 flex-col"><MessageTimeline messages={messages} activeRunId={activeRunId} containerRef={containerRef} isAtBottom={isAtBottom} scrollToBottom={scrollToBottom} onSuggestion={setDraft} /><Composer draft={draft} setDraft={setDraft} stagedFiles={stagedFiles} fileInputRef={fileInputRef} onFiles={event => void handleFileChange(event)} onRemoveFile={file => setStagedFiles(current => current.filter(item => item.file !== file))} onSubmit={handleSubmit} onStop={() => void stop()} activeRunId={activeRunId} isCancelling={isCancelling} connectionStatus={connectionStatus} /></div>;
}

