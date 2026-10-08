package io.github.gajendrasinghdawar.lali.feature.chat

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import io.github.gajendrasinghdawar.lali.data.chat.*
import io.github.gajendrasinghdawar.lali.ui.components.ConnectionStatus
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch

data class ChatUiState(val conversation: ConversationState = ConversationState(), val draft: String = "") {
    val canSend: Boolean get() = draft.isNotBlank() && !conversation.sending && !conversation.projection.busy && conversation.connection == ConnectionStatus.Online
}

class ChatViewModel(private val id: String, private val repository: ChatRepository) : ViewModel() {
    private val draft = MutableStateFlow("")
    val uiState = combine(repository.state, draft) { state, text -> ChatUiState(state, text) }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(0), ChatUiState())
    suspend fun connect() { repository.connect(id) }
    fun editDraft(value: String) { draft.value = value }
    fun send() {
        val text = draft.value
        if (!ChatUiState(repository.state.value, text).canSend) return
        draft.value = ""
        viewModelScope.launch {
            if (!repository.send(id, text) && draft.value.isEmpty()) draft.value = text
        }
    }
}
