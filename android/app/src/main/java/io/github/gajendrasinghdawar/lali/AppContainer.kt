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

import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import io.ktor.client.plugins.contentnegotiation.ContentNegotiation
import kotlinx.serialization.json.Json
import io.ktor.serialization.kotlinx.json.json

class TokenRepository(context: Context) {
    private val masterKey = MasterKey.Builder(context)
        .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
        .build()

    private val prefs: SharedPreferences = EncryptedSharedPreferences.create(
        context,
        "secure_auth_prefs",
        masterKey,
        EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
        EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
    )

    private val _tokenFlow = MutableStateFlow(prefs.getString("token", null))
    val tokenFlow: StateFlow<String?> = _tokenFlow.asStateFlow()

    var token: String?
        get() = prefs.getString("token", null)
        set(value) {
            prefs.edit().putString("token", value).apply()
            _tokenFlow.value = value
        }
    
    fun clear() {
        prefs.edit().remove("token").apply()
        _tokenFlow.value = null
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
      install(ContentNegotiation) {
        json(Json {
          ignoreUnknownKeys = true
          explicitNulls = false
          encodeDefaults = true
        })
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

  val authRepository: io.github.gajendrasinghdawar.lali.core.auth.AuthRepository = 
    io.github.gajendrasinghdawar.lali.core.auth.DefaultAuthRepository(httpClient, tokenRepository, gatewayBaseUrl)
}
