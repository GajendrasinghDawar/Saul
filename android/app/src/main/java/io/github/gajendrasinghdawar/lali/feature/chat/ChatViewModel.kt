package io.github.gajendrasinghdawar.lali.feature.chat

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import io.github.gajendrasinghdawar.lali.data.chat.*
import io.github.gajendrasinghdawar.lali.ui.components.ConnectionStatus
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch
import kotlinx.coroutines.CancellationException
import java.util.UUID

data class DraftAttachment(val key: String, val file: Attachment? = null, val uploading: Boolean = true, val error: String? = null)
data class AttachmentDraft(val capabilities: ArtifactCapabilities = ArtifactCapabilities(), val files: List<DraftAttachment> = emptyList(), val notice: String? = null)
data class ChatUiState(val conversation: ConversationState = ConversationState(), val draft: String = "", val thinkingOverrides: Map<String, Boolean> = emptyMap(), val attachments: AttachmentDraft = AttachmentDraft()) {
    val canSend: Boolean get() = (draft.isNotBlank() || attachments.files.any { it.file != null }) && attachments.files.all { !it.uploading && it.error == null } && !conversation.sending && !conversation.projection.busy && conversation.connection == ConnectionStatus.Online
    fun thinkingExpanded(message: ChatMessage): Boolean = thinkingOverrides[message.id] ?: !message.complete
}

class ChatViewModel(private val id: String, private val repository: ChatRepository, private val artifacts: ArtifactRepository? = null) : ViewModel() {
    private val draft = MutableStateFlow("")
    private var draftRevision = 0L
    private var submitting = false
    private val thinking = MutableStateFlow<Map<String, Boolean>>(emptyMap())
    private val attachments = MutableStateFlow(AttachmentDraft())
    val uiState = combine(repository.state, draft, thinking, attachments) { state, text, overrides, files -> ChatUiState(state, text, overrides, files) }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(0), ChatUiState())
    suspend fun connect() {
        viewModelScope.launch {
            try { artifacts?.capabilities()?.let { capabilities -> attachments.update { it.copy(capabilities = capabilities, notice = if (capabilities.enabled) null else "Attachments are unavailable on this server.") } } }
            catch (e: CancellationException) { throw e }
            catch (_: Exception) { attachments.update { it.copy(capabilities = ArtifactCapabilities(), notice = "Attachments unavailable. Text chat is still available.") } }
        }
        repository.connect(id)
    }
    fun addFiles(uris: List<String>) {
        val service = artifacts ?: return
        val capabilities = attachments.value.capabilities
        if (!capabilities.enabled || repository.state.value.sending) return
        val available = capabilities.maxFilesPerMessage - attachments.value.files.size
        if (uris.size > available) attachments.update { it.copy(notice = "Choose at most ${capabilities.maxFilesPerMessage} files per message.") }
        uris.take(available.coerceAtLeast(0)).forEach { uri ->
            val key = UUID.randomUUID().toString()
            attachments.update { it.copy(files = it.files + DraftAttachment(key)) }
            viewModelScope.launch {
                try {
                    val file = service.upload(uri, capabilities)
                    attachments.update { it.copy(files = it.files.map { row -> if (row.key == key) row.copy(file = file, uploading = false) else row }) }
                } catch (e: CancellationException) { throw e }
                catch (e: Exception) { attachments.update { it.copy(files = it.files.map { row -> if (row.key == key) row.copy(uploading = false, error = if (e is IllegalArgumentException) e.message else "Upload failed. Remove this file and select it again.") else row }) } }
            }
        }
    }
    fun removeFile(key: String) { if (!repository.state.value.sending) attachments.update { it.copy(files = it.files.filterNot { row -> row.key == key }) } }
    fun download(file: Attachment, destination: String) {
        val service = artifacts ?: return
        viewModelScope.launch {
            try {
                service.download(file, destination)
                attachments.update { it.copy(notice = "File saved: ${file.name}") }
            } catch (e: CancellationException) { throw e }
            catch (_: Exception) { attachments.update { it.copy(notice = "Could not save the file. Check your connection and try again.") } }
        }
    }
    fun editDraft(value: String) { draftRevision++; draft.value = value }
    fun toggleThinking(id: String) {
        val message = repository.state.value.projection.messages.find { it.id == id } ?: return
        thinking.update { it + (id to !(it[id] ?: !message.complete)) }
    }
    fun send() {
        val text = draft.value
        val files = attachments.value.files
        if (submitting || !ChatUiState(repository.state.value, text, attachments = attachments.value).canSend) return
        val revision = draftRevision
        submitting = true
        viewModelScope.launch {
            try {
                if (repository.send(id, text, files.mapNotNull { it.file })) {
                    if (draftRevision == revision) draft.value = ""
                    attachments.update { it.copy(files = it.files.filterNot { row -> files.any { sent -> sent.key == row.key } }) }
                }
            } finally { submitting = false }
        }
    }
}
