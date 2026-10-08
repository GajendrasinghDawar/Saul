package io.github.gajendrasinghdawar.lali.feature.chat

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import io.github.gajendrasinghdawar.lali.data.chat.*
import io.github.gajendrasinghdawar.lali.ui.components.ConnectionStatus
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch

data class ChatUiState(val conversation: ConversationState = ConversationState(), val draft: String = "", val thinkingOverrides: Map<String, Boolean> = emptyMap()) {
    val canSend: Boolean get() = draft.isNotBlank() && !conversation.sending && !conversation.projection.busy && conversation.connection == ConnectionStatus.Online
    fun thinkingExpanded(message: ChatMessage): Boolean = thinkingOverrides[message.id] ?: !message.complete
}

class ChatViewModel(private val id: String, private val repository: ChatRepository) : ViewModel() {
    private val draft = MutableStateFlow("")
    private val thinking = MutableStateFlow<Map<String, Boolean>>(emptyMap())
    val uiState = combine(repository.state, draft, thinking) { state, text, overrides -> ChatUiState(state, text, overrides) }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(0), ChatUiState())
    suspend fun connect() { repository.connect(id) }
    fun editDraft(value: String) { draft.value = value }
    fun toggleThinking(id: String) {
        val message = repository.state.value.projection.messages.find { it.id == id } ?: return
        thinking.update { it + (id to !(it[id] ?: !message.complete)) }
    }
    fun send() {
        val text = draft.value
        if (!ChatUiState(repository.state.value, text).canSend) return
        draft.value = ""
        viewModelScope.launch {
            if (!repository.send(id, text) && draft.value.isEmpty()) draft.value = text
        }
    }
}
