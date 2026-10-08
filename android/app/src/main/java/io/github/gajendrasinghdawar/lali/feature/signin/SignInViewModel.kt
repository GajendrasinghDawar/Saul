package io.github.gajendrasinghdawar.lali.feature.signin

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import io.github.gajendrasinghdawar.lali.core.network.GatewayClient
import io.github.gajendrasinghdawar.lali.core.network.GatewayHealth
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

import io.github.gajendrasinghdawar.lali.core.auth.AuthRepository

sealed interface GatewayStatus {
  data object NotConfigured : GatewayStatus
  data object NotChecked : GatewayStatus
  data object Checking : GatewayStatus
  data class Checked(val health: GatewayHealth) : GatewayStatus
}

sealed interface AuthFlowState {
  data object Idle : AuthFlowState
  data object RequestingCode : AuthFlowState
  data class WaitingForApproval(
    val userCode: String,
    val deviceCode: String,
    val verificationUri: String,
    val pollAttempt: Int = 0,
    val liveStatus: String = "Code generated. Opening browser...",
  ) : AuthFlowState
  data class Success(val token: String) : AuthFlowState
  data class Error(val message: String, val details: String? = null) : AuthFlowState
}

data class SignInUiState(
  val gatewayBaseUrl: String?, 
  val gatewayStatus: GatewayStatus,
  val authState: AuthFlowState = AuthFlowState.Idle
)

class SignInViewModel(
    private val gatewayClient: GatewayClient?,
    private val authRepository: AuthRepository
) : ViewModel() {
  private val _uiState = MutableStateFlow(
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

  fun resetFlow() {
    _uiState.value = _uiState.value.copy(authState = AuthFlowState.Idle)
  }

  fun beginSignIn() {
      if (_uiState.value.authState is AuthFlowState.RequestingCode || _uiState.value.authState is AuthFlowState.WaitingForApproval) return
      
      _uiState.value = _uiState.value.copy(authState = AuthFlowState.RequestingCode)
      viewModelScope.launch {
          try {
              val response = authRepository.beginSignIn()
              val webBaseUrl = io.github.gajendrasinghdawar.lali.BuildConfig.WEB_BASE_URL
              
              val uri = if (webBaseUrl.isNotEmpty()) {
                  "$webBaseUrl/device?user_code=${response.userCode}"
              } else {
                  val rawUri = response.verificationUriComplete 
                      ?: response.verificationUri
                      ?: "/device"
                  if (rawUri.startsWith("http")) rawUri else "${gatewayClient?.baseUrl}$rawUri"
              }
              
              _uiState.value = _uiState.value.copy(
                  authState = AuthFlowState.WaitingForApproval(
                      userCode = response.userCode,
                      deviceCode = response.deviceCode,
                      verificationUri = uri,
                      liveStatus = "Code [${response.userCode}] active. Awaiting your approval in browser."
                  )
              )
              
              val token = authRepository.pollForToken(
                  deviceCode = response.deviceCode, 
                  interval = response.interval, 
                  expiresIn = response.expiresIn,
                  onPollProgress = { attempt, status ->
                      val current = _uiState.value.authState
                      if (current is AuthFlowState.WaitingForApproval) {
                          _uiState.value = _uiState.value.copy(
                              authState = current.copy(
                                  pollAttempt = attempt,
                                  liveStatus = status
                              )
                          )
                      }
                  }
              )
              
              if (token != null) {
                  _uiState.value = _uiState.value.copy(authState = AuthFlowState.Success(token))
              } else {
                  _uiState.value = _uiState.value.copy(authState = AuthFlowState.Error("Authorization expired or denied"))
              }
          } catch (e: Exception) {
              _uiState.value = _uiState.value.copy(authState = AuthFlowState.Error("Connection error: ${e.message}"))
          }
      }
  }
}
