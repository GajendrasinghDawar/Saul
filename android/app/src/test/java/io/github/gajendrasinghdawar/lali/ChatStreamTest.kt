package io.github.gajendrasinghdawar.lali

import io.github.gajendrasinghdawar.lali.core.network.GatewayApi
import io.github.gajendrasinghdawar.lali.data.chat.*
import io.github.gajendrasinghdawar.lali.ui.components.ConnectionStatus
import io.ktor.client.HttpClient
import io.ktor.client.engine.cio.CIO
import io.ktor.client.plugins.sse.SSE
import com.sun.net.httpserver.HttpServer
import java.net.InetSocketAddress
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.runTest
import org.junit.Test
import org.junit.Assert.*

class ChatStreamTest {
    private val user = """{"id":11,"kind":"pi.user","model":[{"content":"Hello"}]}"""
    private fun live(text: String) = """{"type":"update","view":{"entries":[$user],"docs":{"pi.live":{"run":{"taskId":71},"generation":{"message":{"content":[{"type":"text","text":"$text"},{"type":"thinking","thinking":"Consider carefully"}]}}}}}}"""

    @Test fun growingSnapshotsReplaceRatherThanAppendAndFinalReplacesLive() {
        assertEquals("Hel", parseSnapshot(live("Hel")).messages.last().text)
        val growing = parseSnapshot(live("Hello there"))
        assertEquals(2, growing.messages.size)
        assertEquals("Hello there", growing.messages.last().text)
        assertEquals("Consider carefully", growing.messages.last().thinking)
        assertTrue(growing.busy)
        val final = parseSnapshot("""{"type":"update","view":{"entries":[$user,{"id":12,"kind":"pi.assistant","model":[{"content":[{"type":"text","text":"Hello there"}]}]}],"docs":{}}}""")
        assertEquals(listOf("11", "12"), final.messages.map { it.id })
        assertEquals("Hello there", final.messages.last().text)
        assertFalse(final.busy)
        assertTrue(final.messages.last().complete)
    }

    @Test fun unknownAndMalformedPartsAreIgnoredAndAssistantEntriesGroup() {
        val state = parseSnapshot("""{"type":"init","view":{"entries":[$user,{"id":12,"kind":"pi.assistant","model":[{"content":[null,7,{"type":"unknown"},{"type":"text","text":"First "}]}]},{"id":13,"kind":"pi.tool-result"},{"id":14,"kind":"pi.assistant","model":[{"content":"second"}]}]}}""")
        assertEquals(2, state.messages.size)
        assertEquals("First second", state.messages.last().text)
    }

    @Test fun ktorSseUsesBearerAndCorrectQueryAndCancels() = runBlocking {
        val server = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
        var query: String? = null
        var authorization: String? = null
        server.createContext("/api/stream") { exchange ->
            query = exchange.requestURI.query
            authorization = exchange.requestHeaders.getFirst("Authorization")
            exchange.responseHeaders.add("Content-Type", "text/event-stream")
            exchange.sendResponseHeaders(200, 0)
            exchange.responseBody.use { it.write("data: ${live("Hel")}\n\ndata: ${live("Hello there")}\n\n".toByteArray()) }
        }
        server.start()
        val http = HttpClient(CIO) { install(SSE) { maxReconnectionAttempts = 0 } }
        try {
            val repository = GatewayChatRepository(GatewayApi(http, "http://127.0.0.1:${server.address.port}", { "fixture" }, {}))
            val connection = launch { repository.connect("71") }
            val state = withTimeout(5_000) { repository.state.first { it.projection.messages.lastOrNull()?.text == "Hello there" } }
            assertEquals("conversationId=71", query)
            assertEquals("Bearer fixture", authorization)
            assertEquals(2, state.projection.messages.size)
            connection.cancelAndJoin()
            assertEquals(ConnectionStatus.Offline, repository.state.value.connection)
        } finally { http.close(); server.stop(0) }
    }

    @Test fun unauthorizedStreamClearsCredentialAndStopsRetrying() = runBlocking {
        var calls = 0
        var cleared = false
        val server = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
        server.createContext("/api/stream") { exchange -> calls++; exchange.sendResponseHeaders(401, -1); exchange.close() }
        server.start()
        val http = HttpClient(CIO) { install(SSE) }
        try {
            val repository = GatewayChatRepository(GatewayApi(http, "http://127.0.0.1:${server.address.port}", { "expired" }, { cleared = true }))
            withTimeout(5_000) { repository.connect("71") }
            assertTrue(cleared)
            assertEquals(1, calls)
            assertEquals(ConnectionStatus.Offline, repository.state.value.connection)
        } finally { http.close(); server.stop(0) }
    }
}
