package io.github.gajendrasinghdawar.lali.feature.signin

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import io.github.gajendrasinghdawar.lali.core.network.GatewayClient
import io.github.gajendrasinghdawar.lali.core.network.GatewayHealth
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

sealed interface GatewayStatus {
  data object NotConfigured : GatewayStatus

  data object NotChecked : GatewayStatus

  data object Checking : GatewayStatus

  data class Checked(val health: GatewayHealth) : GatewayStatus
}

data class SignInUiState(val gatewayBaseUrl: String?, val gatewayStatus: GatewayStatus)

class SignInViewModel(private val gatewayClient: GatewayClient?) : ViewModel() {
  private val _uiState =
    MutableStateFlow(
      SignInUiState(
        gatewayBaseUrl = gatewayClient?.baseUrl,
        gatewayStatus = if (gatewayClient == null) GatewayStatus.NotConfigured else GatewayStatus.NotChecked,
      )
    )
  val uiState: StateFlow<SignInUiState> = _uiState.asStateFlow()

  fun checkGateway() {
    val client = gatewayClient ?: return
    if (_uiState.value.gatewayStatus == GatewayStatus.Checking) return
    _uiState.value = _uiState.value.copy(gatewayStatus = GatewayStatus.Checking)
    viewModelScope.launch {
      val health = client.checkHealth()
      _uiState.value = _uiState.value.copy(gatewayStatus = GatewayStatus.Checked(health))
    }
  }
}
