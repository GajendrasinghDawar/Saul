package io.github.gajendrasinghdawar.lali

import android.content.Context
import io.github.gajendrasinghdawar.lali.core.auth.*
import io.github.gajendrasinghdawar.lali.core.network.*
import io.github.gajendrasinghdawar.lali.data.conversations.GatewayConversationRepository
import io.ktor.client.HttpClient
import io.ktor.client.engine.android.Android
import io.ktor.client.plugins.contentnegotiation.ContentNegotiation
import io.ktor.client.plugins.sse.SSE
import io.ktor.serialization.kotlinx.json.json
import kotlinx.serialization.json.Json

class AppContainer(context: Context, gatewayBaseUrl: String) {
    val tokenRepository = TokenRepository(context)
    private val httpClient = HttpClient(Android) {
        engine { connectTimeout = 5_000; socketTimeout = 0 }
        install(ContentNegotiation) { json(Json { ignoreUnknownKeys = true }) }
        install(SSE) { maxReconnectionAttempts = 0 }
    }
    val api = GatewayApi(httpClient, gatewayBaseUrl, { tokenRepository.tokenFlow.value }, tokenRepository::clear)
    val gatewayClient = gatewayBaseUrl.takeIf { it.isNotBlank() }?.let { GatewayClient(httpClient, it) }
    val authRepository: AuthRepository = DefaultAuthRepository(httpClient, tokenRepository, gatewayBaseUrl)
    val conversationRepository = GatewayConversationRepository(api)
}
