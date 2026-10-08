package io.github.gajendrasinghdawar.lali.feature.tasks

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import io.github.gajendrasinghdawar.lali.data.tasks.*
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.*

data class TasksUiState(val tasks: List<TaskSummary> = emptyList(), val loading: Boolean = true, val working: Boolean = false, val error: String? = null)

class TasksViewModel(private val repository: TaskRepository) : ViewModel() {
    private val state = MutableStateFlow(TasksUiState())
    val uiState = state.asStateFlow()
    init { refresh() }

    fun refresh() = update { }
    fun abort(id: String) {
        if (state.value.tasks.none { it.id == id && !it.abortRequested }) return
        update { repository.abort(id) }
    }

    private fun update(action: suspend () -> Unit) {
        if (state.value.working) return
        state.update { it.copy(working = true, error = null) }
        viewModelScope.launch {
            try {
                action()
                val tasks = repository.list()
                state.update { it.copy(tasks = tasks) }
            } catch (e: CancellationException) { throw e }
            catch (_: Exception) { state.update { it.copy(error = "Could not update tasks. Try again.") } }
            finally { state.update { it.copy(loading = false, working = false) } }
        }
    }
}
