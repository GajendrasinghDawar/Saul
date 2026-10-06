package io.github.gajendrasinghdawar.lali

import android.content.Context
import io.github.gajendrasinghdawar.lali.core.network.GatewayClient
import io.ktor.client.HttpClient
import io.ktor.client.engine.android.Android
import io.ktor.client.plugins.auth.Auth
import io.ktor.client.plugins.auth.providers.BearerTokens
import io.ktor.client.plugins.auth.providers.bearer
import android.content.SharedPreferences

class TokenRepository(context: Context) {
    private val prefs: SharedPreferences = context.getSharedPreferences("auth_prefs", Context.MODE_PRIVATE)

    var token: String?
        get() = prefs.getString("token", null)
        set(value) {
            prefs.edit().putString("token", value).apply()
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
