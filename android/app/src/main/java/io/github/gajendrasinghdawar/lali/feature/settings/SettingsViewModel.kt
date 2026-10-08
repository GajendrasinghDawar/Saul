package io.github.gajendrasinghdawar.lali.feature.settings

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import io.github.gajendrasinghdawar.lali.data.settings.*
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.*

data class SettingsUiState(val gatewayUrl: String, val account: Account? = null, val loading: Boolean = true, val signingOut: Boolean = false, val error: String? = null)

class SettingsViewModel(private val repository: SettingsRepository) : ViewModel() {
    private val state = MutableStateFlow(SettingsUiState(repository.gatewayUrl))
    val uiState = state.asStateFlow()
    private var refreshJob: Job? = null
    init { refresh() }

    fun refresh() {
        if (state.value.signingOut || refreshJob?.isActive == true) return
        state.update { it.copy(loading = true, error = null) }
        refreshJob = viewModelScope.launch {
            try {
                val account = repository.account()
                state.update { it.copy(account = account) }
            } catch (e: CancellationException) { throw e }
            catch (_: Exception) { state.update { it.copy(error = "Could not load account. Try again.") } }
            finally { state.update { it.copy(loading = false) } }
        }
    }
    fun signOut() {
        if (state.value.signingOut) return
        refreshJob?.cancel()
        state.update { it.copy(signingOut = true, error = null) }
        viewModelScope.launch {
            try {
                repository.signOut()
                state.update { it.copy(account = null) }
            } catch (e: CancellationException) { throw e }
            catch (_: Exception) { state.update { it.copy(error = "Could not revoke this session. Check your connection and retry sign-out.") } }
            finally { state.update { it.copy(signingOut = false) } }
        }
    }
}
