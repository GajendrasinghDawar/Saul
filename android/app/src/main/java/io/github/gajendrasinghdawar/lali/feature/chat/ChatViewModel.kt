package io.github.gajendrasinghdawar.lali.feature.chat

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import io.github.gajendrasinghdawar.lali.data.chat.*
import io.github.gajendrasinghdawar.lali.ui.components.ConnectionStatus
import kotlinx.coroutines.flow.*

data class ChatUiState(val conversation: ConversationState = ConversationState())

class ChatViewModel(private val id: String, private val repository: ChatRepository) : ViewModel() {
    val uiState = repository.state.map { ChatUiState(it) }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(0), ChatUiState())
    suspend fun connect() { repository.connect(id) }
}
