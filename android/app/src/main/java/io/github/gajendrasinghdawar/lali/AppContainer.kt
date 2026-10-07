package io.github.gajendrasinghdawar.lali

import android.content.Context
import io.github.gajendrasinghdawar.lali.core.network.GatewayClient
import io.ktor.client.HttpClient
import io.ktor.client.engine.android.Android
import io.ktor.client.plugins.auth.Auth
import io.ktor.client.plugins.auth.providers.BearerTokens
import io.ktor.client.plugins.auth.providers.bearer
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import android.content.SharedPreferences

class TokenRepository(context: Context) {
    private val prefs: SharedPreferences = context.getSharedPreferences("auth_prefs", Context.MODE_PRIVATE)

    private val _tokenFlow = MutableStateFlow(prefs.getString("token", null))
    val tokenFlow: StateFlow<String?> = _tokenFlow.asStateFlow()

    var token: String?
        get() = prefs.getString("token", null)
        set(value) {
            prefs.edit().putString("token", value).apply()
            _tokenFlow.value = value
        }
}

class AppContainer(context: Context, gatewayBaseUrl: String) {
  val tokenRepository = TokenRepository(context)

  private val httpClient =
    HttpClient(Android) {
      engine {
        connectTimeout = 5_000
        socketTimeout = 15_000
      }
      install(Auth) {
        bearer {
          loadTokens {
            tokenRepository.token?.let { BearerTokens(it, "") }
          }
        }
      }
    }

  /** Null when the build has no Gateway URL configured. */
  val gatewayClient: GatewayClient? = gatewayBaseUrl.takeIf { it.isNotBlank() }?.let { GatewayClient(httpClient, it) }
}
