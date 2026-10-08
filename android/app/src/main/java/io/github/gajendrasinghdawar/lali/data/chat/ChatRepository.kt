package io.github.gajendrasinghdawar.lali.data.chat

import io.github.gajendrasinghdawar.lali.core.network.*
import io.github.gajendrasinghdawar.lali.ui.components.ConnectionStatus
import io.ktor.client.plugins.sse.*
import io.ktor.client.request.*
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.*
import kotlin.random.Random

data class ConversationState(
    val projection: ChatProjection = ChatProjection(),
    val connection: ConnectionStatus = ConnectionStatus.Offline,
    val error: String? = null,
)

interface ChatRepository {
    val state: StateFlow<ConversationState>
    suspend fun connect(id: String)
}

/** One instance per chat destination; snapshots replace history, never append it. */
class GatewayChatRepository(private val api: GatewayApi) : ChatRepository {
    private val mutableState = MutableStateFlow(ConversationState())
    override val state = mutableState.asStateFlow()

    override suspend fun connect(id: String) {
        var backoff = 1_000L
        try {
            while (currentCoroutineContext().isActive) {
                mutableState.update { it.copy(connection = ConnectionStatus.Connecting) }
                try {
                    api.http.sse(request = {
                        url("${api.baseUrl.trimEnd('/')}/api/stream")
                        parameter("conversationId", id)
                        api.authorize(this)
                        bufferPolicy(SSEBufferPolicy.Off)
                    }) {
                        api.check(call.response)
                        incoming.collect { event ->
                            val data = event.data ?: return@collect
                            try {
                                val projection = parseSnapshot(data)
                                mutableState.update { it.copy(projection = projection, connection = ConnectionStatus.Online, error = null) }
                                backoff = 1_000L
                            } catch (_: IllegalArgumentException) {
                                mutableState.update { it.copy(error = "Could not read stream update. Last valid transcript retained.") }
                            }
                        }
                    }
                } catch (e: CancellationException) { throw e }
                catch (e: SSEClientException) {
                    e.response?.let { response ->
                        try { api.check(response) }
                        catch (failure: GatewayException) {
                            if (failure.status in listOf(401, 403, 404)) {
                                mutableState.update { it.copy(error = "Conversation unavailable.") }
                                return
                            }
                        }
                    }
                } catch (_: Exception) { /* Retry transport failures without logging private payloads. */ }
                mutableState.update { it.copy(connection = ConnectionStatus.Connecting, error = "Connection lost. Reconnecting…") }
                delay(backoff + Random.nextLong(0, backoff / 4 + 1))
                backoff = (backoff * 2).coerceAtMost(30_000L)
            }
        } finally { mutableState.update { it.copy(connection = ConnectionStatus.Offline) } }
    }
}
