package io.github.gajendrasinghdawar.lali

import io.github.gajendrasinghdawar.lali.core.network.GatewayApi
import io.github.gajendrasinghdawar.lali.data.chat.*
import io.github.gajendrasinghdawar.lali.feature.chat.*
import io.github.gajendrasinghdawar.lali.ui.components.ConnectionStatus
import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.*
import io.ktor.http.*
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.test.*
import org.junit.*
import org.junit.Assert.*

@OptIn(ExperimentalCoroutinesApi::class)
class ChatSendTest {
    private fun snapshot(extra: String = "") = """{"type":"update","view":{"entries":[{"id":11,"kind":"pi.user","model":[{"content":"Again"}]}$extra]}}"""
    private val delivered = """,{"id":21,"kind":"pi.user","model":[{"content":"Again"}]},{"id":22,"kind":"pi.assistant","model":[{"content":"New answer"}]}"""

    @Test fun bothHttpAndSnapshotOrderingsReconcileRepeatedTextOnce() = runTest {
        for (snapshotFirst in listOf(true, false)) {
            val received = CompletableDeferred<Unit>()
            val reply = CompletableDeferred<Unit>()
            val http = HttpClient(MockEngine { request ->
                assertEquals(HttpMethod.Post, request.method)
                assertEquals("/api/chat", request.url.encodedPath)
                assertEquals("Bearer fixture", request.headers[HttpHeaders.Authorization])
                received.complete(Unit)
                reply.await()
                respond("""{"success":true}""", headers = headersOf(HttpHeaders.ContentType, "application/json"))
            })
            val repo = GatewayChatRepository(GatewayApi(http, "http://gateway", { "fixture" }, {}))
            repo.acceptSnapshot(snapshot())
            val sending = async { repo.send("7", "Again") }
            received.await()
            assertTrue(repo.state.value.projection.messages.last().sending)
            repo.acceptSnapshot(snapshot())
            assertEquals(2, repo.state.value.projection.messages.size) // Old identical text must not acknowledge this send.
            if (snapshotFirst) repo.acceptSnapshot(snapshot(delivered))
            reply.complete(Unit)
            assertTrue(sending.await())
            if (!snapshotFirst) {
                assertTrue(repo.state.value.sending)
                repo.acceptSnapshot(snapshot(delivered))
            }
            assertEquals(listOf("11", "21", "22"), repo.state.value.projection.messages.map { it.id })
            assertFalse(repo.state.value.sending)
            http.close()
        }
    }

    @Test fun rejectedSendRollsBackOnlyOptimisticMessage() = runTest {
        val http = HttpClient(MockEngine { respond("{}", HttpStatusCode.ServiceUnavailable) })
        val repo = GatewayChatRepository(GatewayApi(http, "http://gateway", { "fixture" }, {}))
        repo.acceptSnapshot(snapshot())
        assertFalse(repo.send("7", "Again"))
        assertEquals(listOf("11"), repo.state.value.projection.messages.map { it.id })
        assertFalse(repo.state.value.sending)
        assertNotNull(repo.state.value.error)
        http.close()
    }

    @Test fun viewModelRestoresFailedDraftAndBlocksBusyDispatch() = runTest {
        Dispatchers.setMain(StandardTestDispatcher(testScheduler))
        try {
            var sends = 0
            val fake = object : ChatRepository {
                override val state = MutableStateFlow(ConversationState(connection = ConnectionStatus.Online))
                override suspend fun connect(id: String) = Unit
                override suspend fun send(id: String, message: String): Boolean { sends++; return false }
            }
            val vm = ChatViewModel("7", fake)
            val collector = backgroundScope.launch(UnconfinedTestDispatcher(testScheduler)) { vm.uiState.collect() }
            vm.editDraft("Keep this draft"); runCurrent()
            assertTrue(vm.uiState.value.canSend)
            vm.send(); runCurrent()
            assertEquals("Keep this draft", vm.uiState.value.draft)
            fake.state.value = fake.state.value.copy(projection = ChatProjection(busy = true)); runCurrent()
            vm.send(); runCurrent()
            assertEquals(1, sends)
            assertFalse(vm.uiState.value.canSend)
            collector.cancel()
        } finally { Dispatchers.resetMain() }
    }
}
