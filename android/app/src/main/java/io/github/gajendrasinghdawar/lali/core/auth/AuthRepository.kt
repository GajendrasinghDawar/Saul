package io.github.gajendrasinghdawar.lali.core.auth

import io.ktor.client.HttpClient
import io.ktor.client.call.body
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.http.ContentType
import io.ktor.http.contentType
import io.ktor.http.HttpMethod
import io.github.gajendrasinghdawar.lali.core.network.GatewayApi
import io.github.gajendrasinghdawar.lali.core.network.GatewayException
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.withContext
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.StateFlow
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

import io.ktor.client.statement.bodyAsText

@Serializable
data class DeviceCodeRequest(
    @SerialName("client_id") val clientId: String
)

@Serializable
data class DeviceCodeResponse(
    @SerialName("device_code") val deviceCode: String,
    @SerialName("user_code") val userCode: String,
    @SerialName("verification_uri") val verificationUri: String? = null,
    @SerialName("verification_uri_complete") val verificationUriComplete: String? = null,
    @SerialName("expires_in") val expiresIn: Int,
    val interval: Int = 5
)

@Serializable
data class DeviceTokenRequest(
    @SerialName("grant_type") val grantType: String,
    @SerialName("device_code") val deviceCode: String,
    @SerialName("client_id") val clientId: String
)

@Serializable
data class DeviceTokenResponse(
    @SerialName("access_token") val accessToken: String? = null,
    @SerialName("error") val error: String? = null,
    @SerialName("error_description") val errorDescription: String? = null
)

interface AuthRepository {
    val sessionToken: StateFlow<String?>
    suspend fun beginSignIn(): DeviceCodeResponse
    suspend fun pollForToken(
        deviceCode: String, 
        interval: Int, 
        expiresIn: Int,
        onPollProgress: ((attempt: Int, status: String) -> Unit)? = null
    ): String?
    suspend fun signOut()
}

class DefaultAuthRepository(
    private val httpClient: HttpClient,
    private val tokenRepository: CredentialStore,
    private val gatewayBaseUrl: String
) : AuthRepository {
    
    override val sessionToken: StateFlow<String?> = tokenRepository.tokenFlow

    override suspend fun beginSignIn(): DeviceCodeResponse {
        return httpClient.post("$gatewayBaseUrl/api/auth/device/code") {
            contentType(ContentType.Application.Json)
            setBody(DeviceCodeRequest(clientId = "android-client"))
        }.body()
    }

    override suspend fun pollForToken(
        deviceCode: String, 
        interval: Int, 
        expiresIn: Int,
        onPollProgress: ((attempt: Int, status: String) -> Unit)?
    ): String? {
        val endTime = System.currentTimeMillis() + (expiresIn * 1000L)
        val pollInterval = (if (interval > 0) interval else 5) * 1000L
        val jsonParser = kotlinx.serialization.json.Json { ignoreUnknownKeys = true }
        var attempt = 0
        
        while (System.currentTimeMillis() < endTime) {
            attempt++
            try {
                val httpResponse = httpClient.post("$gatewayBaseUrl/api/auth/device/token") {
                    contentType(ContentType.Application.Json)
                    setBody(
                        DeviceTokenRequest(
                            grantType = "urn:ietf:params:oauth:grant-type:device_code",
                            deviceCode = deviceCode,
                            clientId = "android-client"
                        )
                    )
                }

                val rawText = httpResponse.bodyAsText()
                val parsed = try { jsonParser.decodeFromString<DeviceTokenResponse>(rawText) } catch (_: Exception) { null }

                if (httpResponse.status.value in 200..299 && parsed?.accessToken != null) {
                    tokenRepository.save(parsed.accessToken)
                    onPollProgress?.invoke(attempt, "Token received! Transitioning to session...")
                    return parsed.accessToken
                }

                val errorMsg = parsed?.error ?: rawText.ifBlank { "HTTP ${httpResponse.status.value}" }

                if (errorMsg == "authorization_pending") {
                    onPollProgress?.invoke(attempt, "Awaiting approval in browser (attempt #$attempt)")
                } else if (errorMsg == "slow_down") {
                    onPollProgress?.invoke(attempt, "Server asked to slow down polling (attempt #$attempt)")
                } else if (errorMsg == "expired_token" || errorMsg == "access_denied") {
                    onPollProgress?.invoke(attempt, "Terminal status: $errorMsg")
                    return null
                } else {
                    onPollProgress?.invoke(attempt, "Response: $errorMsg (attempt #$attempt)")
                }
            } catch (e: Exception) {
                onPollProgress?.invoke(attempt, "Poll retry: ${e.message ?: "network issue"}")
            }
            
            delay(pollInterval)
        }
        onPollProgress?.invoke(attempt, "Device code expired after ${expiresIn}s")
        return null
    }

    override suspend fun signOut() {
        if (sessionToken.value != null) {
            val api = GatewayApi(httpClient, gatewayBaseUrl, { sessionToken.value }, tokenRepository::clear)
            try { api.request(HttpMethod.Post, "/api/auth/sign-out") }
            catch (e: GatewayException) { if (e.status != 401) throw e }
        }
        // Auth-driven navigation can dispose this ViewModel during credential removal.
        withContext(NonCancellable) { tokenRepository.clear() }
    }
}
