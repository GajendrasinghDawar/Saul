package io.github.gajendrasinghdawar.lali.data.chat

import io.github.gajendrasinghdawar.lali.core.network.*
import io.github.gajendrasinghdawar.lali.ui.components.ConnectionStatus
import io.ktor.client.plugins.sse.*
import io.ktor.client.request.*
import io.ktor.http.HttpMethod
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.*
import kotlinx.serialization.json.*
import java.util.UUID
import kotlin.random.Random

data class ConversationState(
    val projection: ChatProjection = ChatProjection(),
    val connection: ConnectionStatus = ConnectionStatus.Offline,
    val error: String? = null,
    val sending: Boolean = false,
)

interface ChatRepository {
    val state: StateFlow<ConversationState>
    suspend fun connect(id: String)
    suspend fun send(id: String, message: String): Boolean
}

/** One instance per chat destination; snapshots replace history, never append it. */
class GatewayChatRepository(private val api: GatewayApi) : ChatRepository {
    private val mutableState = MutableStateFlow(ConversationState())
    override val state = mutableState.asStateFlow()
    private var canonical = ChatProjection()
    private data class Pending(val message: ChatMessage, val knownIds: Set<String>)
    private var pending: Pending? = null
    private var dispatching = false

    internal fun acceptSnapshot(data: String) {
        canonical = parseSnapshot(data)
        pending?.let { optimistic ->
            if (canonical.messages.any { it.role == MessageRole.User && it.id !in optimistic.knownIds && it.text == optimistic.message.text }) pending = null
        }
        publish()
        mutableState.update { it.copy(connection = ConnectionStatus.Online, error = null) }
    }

    private fun publish() {
        val optimistic = pending?.message
        mutableState.update { it.copy(
            projection = canonical.copy(messages = canonical.messages + listOfNotNull(optimistic)),
            sending = dispatching || optimistic != null,
        ) }
    }

    override suspend fun send(id: String, message: String): Boolean {
        if (message.isBlank() || state.value.sending || canonical.busy || state.value.connection != ConnectionStatus.Online) return false
        val text = message.trim()
        pending = Pending(ChatMessage("pending-${UUID.randomUUID()}", MessageRole.User, text, sending = true), canonical.messages.map { it.id }.toSet())
        dispatching = true
        publish()
        try {
            api.request(HttpMethod.Post, "/api/chat", buildJsonObject {
                put("conversationId", id); put("message", text); put("whenBusy", "reject")
            })
            return true
        } catch (e: CancellationException) { throw e }
        catch (_: Exception) {
            // A snapshot confirming receipt wins over an HTTP timeout or lost response.
            if (pending == null) return true
            pending = null
            mutableState.update { it.copy(error = "Could not confirm delivery. Check the transcript before retrying.") }
            return false
        } finally {
            dispatching = false
            publish()
        }
    }

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
                                acceptSnapshot(data)
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
