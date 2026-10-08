package io.github.gajendrasinghdawar.lali.feature.conversations

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import io.github.gajendrasinghdawar.lali.data.conversations.*
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch

data class ConversationListUiState(
    val conversations: List<ConversationSummary> = emptyList(),
    val loading: Boolean = true,
    val working: Boolean = false,
    val error: String? = null,
    val createdId: String? = null,
)

class ConversationListViewModel(private val repository: ConversationRepository) : ViewModel() {
    private val state = MutableStateFlow(ConversationListUiState())
    val uiState = state.asStateFlow()

    init { refresh() }

    fun refresh() = runAction {
        state.update { it.copy(loading = it.conversations.isEmpty()) }
        reload()
    }
    fun create() = runAction {
        val id = repository.create()
        reload()
        state.update { it.copy(createdId = id) }
    }
    fun openedCreated() { state.update { it.copy(createdId = null) } }
    fun rename(id: String, title: String) {
        if (title.isBlank()) return
        runAction { repository.rename(id, title.trim()); reload() }
    }
    fun delete(id: String) = runAction { repository.delete(id); reload() }

    private suspend fun reload() {
        val conversations = repository.list()
        state.update { it.copy(conversations = conversations) }
    }
    private fun runAction(action: suspend () -> Unit) {
        if (state.value.working) return
        state.update { it.copy(working = true, error = null) }
        viewModelScope.launch {
            try { action() }
            catch (e: CancellationException) { throw e }
            catch (_: Exception) { state.update { it.copy(error = "Could not update conversations. Try again.") } }
            finally { state.update { it.copy(loading = false, working = false) } }
        }
    }
}
