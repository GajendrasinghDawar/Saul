package io.github.gajendrasinghdawar.lali.feature.settings

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import io.github.gajendrasinghdawar.lali.data.settings.*
import io.github.gajendrasinghdawar.lali.core.network.GatewayException
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.*

data class SettingsUiState(val gatewayUrl: String, val account: Account? = null, val loading: Boolean = true, val signingOut: Boolean = false, val error: String? = null,
    val settings: List<ServerSetting> = emptyList(), val working: Boolean = false, val denied: Boolean = false, val notice: String? = null, val editVersion: Int = 0)

class SettingsViewModel(private val repository: SettingsRepository) : ViewModel() {
    private val state = MutableStateFlow(SettingsUiState(repository.gatewayUrl))
    val uiState = state.asStateFlow()
    private var refreshJob: Job? = null
    private var mutationJob: Job? = null
    init { refresh() }

    fun refresh() {
        if (state.value.signingOut || state.value.working || refreshJob?.isActive == true) return
        state.update { it.copy(loading = true, error = null) }
        refreshJob = viewModelScope.launch {
            try {
                val account = repository.account()
                state.update { it.copy(account = account, settings = emptyList(), denied = false) }
                if (account.role == "admin") {
                    val settings = repository.settings()
                    state.update { it.copy(settings = settings) }
                }
            } catch (e: CancellationException) { throw e }
            catch (e: GatewayException) { failure(e, "Could not load settings. Try again.") }
            catch (_: Exception) { state.update { it.copy(error = "Could not load account or server settings. Try again.") } }
            finally { state.update { it.copy(loading = false) } }
        }
    }
    fun save(name: String, value: String) = mutate(name) { repository.save(name, value) }
    fun delete(name: String, password: String) = mutate(name) { repository.delete(name, password) }

    private fun mutate(name: String, action: suspend () -> SettingResult) {
        if (state.value.account?.role != "admin" || state.value.denied || state.value.working || state.value.loading || state.value.signingOut || state.value.settings.none { it.name == name }) return
        state.update { it.copy(working = true, error = null, notice = null) }
        mutationJob = viewModelScope.launch {
            try {
                val result = action()
                state.update { it.copy(editVersion = it.editVersion + 1, notice = if (result.pendingRestart) "Saved. Server restart required; contact your administrator." else if (result.applyMode == "live") "Saved. Applied live." else "Saved. Applies on server restart.") }
                try {
                    val settings = repository.settings()
                    state.update { it.copy(settings = settings) }
                } catch (e: CancellationException) { throw e }
                catch (e: GatewayException) { failure(e, "Change saved, but settings could not refresh. Refresh before making another change.") }
                catch (_: Exception) { state.update { it.copy(error = "Change saved, but settings could not refresh. Refresh before making another change.") } }
            } catch (e: CancellationException) { throw e }
            catch (e: GatewayException) {
                if (e.status == 403) {
                    // A wrong deletion password is also 403. Check read access
                    // before treating that response as a revoked administrator role.
                    state.update { it.copy(error = "Change was not authorized. Check your current password and permissions, then retry.") }
                    try {
                        val settings = repository.settings()
                        state.update { it.copy(settings = settings) }
                    } catch (readError: CancellationException) { throw readError }
                    catch (readError: GatewayException) { failure(readError, "Could not verify access. Refresh settings before retrying.") }
                    catch (_: Exception) { state.update { it.copy(error = "Could not verify access. Refresh settings before retrying.") } }
                } else failure(e, "Could not update setting. Check your connection and current password, then retry.")
            }
            catch (_: Exception) { state.update { it.copy(error = "Could not update setting. Refresh to check server state before retrying.") } }
            finally { state.update { it.copy(working = false) } }
        }
    }
    private fun failure(error: GatewayException, fallback: String) {
        state.update { it.copy(error = when (error.status) { 401 -> "Session expired. Sign in again."; 403 -> "Administrator access denied."; else -> fallback },
            denied = error.status == 403 || it.denied, settings = if (error.status in listOf(401, 403)) emptyList() else it.settings,
            editVersion = if (error.status in listOf(401, 403)) it.editVersion + 1 else it.editVersion) }
    }
    fun leave() {
        mutationJob?.cancel()
        state.update { it.copy(working = false, editVersion = it.editVersion + 1) }
    }
    fun signOut() {
        if (state.value.signingOut) return
        leave()
        refreshJob?.cancel()
        state.update { it.copy(signingOut = true, error = null) }
        viewModelScope.launch {
            try {
                repository.signOut()
                state.update { it.copy(account = null, settings = emptyList()) }
            } catch (e: CancellationException) { throw e }
            catch (_: Exception) { state.update { it.copy(error = "Could not revoke this session. Check your connection and retry sign-out.") } }
            finally { state.update { it.copy(signingOut = false) } }
        }
    }
}
