package io.github.gajendrasinghdawar.lali

import io.github.gajendrasinghdawar.lali.core.network.GatewayApi
import io.github.gajendrasinghdawar.lali.data.chat.*
import io.github.gajendrasinghdawar.lali.feature.chat.ChatViewModel
import io.github.gajendrasinghdawar.lali.ui.components.ConnectionStatus
import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.*
import io.ktor.http.*
import io.ktor.http.content.TextContent
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.test.*
import kotlinx.serialization.json.*
import org.junit.Test
import org.junit.Assert.*

@OptIn(ExperimentalCoroutinesApi::class)
class ChatDeliveryTest {
    @Test fun manualRetriesReuseOnlyTheSameFailedPayloadInTheSameConversation() = runTest {
        val bodies = mutableListOf<JsonObject>()
        val http = HttpClient(MockEngine { request ->
            bodies += Json.parseToJsonElement((request.body as TextContent).text).jsonObject
            respond("{}", HttpStatusCode.ServiceUnavailable)
        })
        try {
            val repo = GatewayChatRepository(GatewayApi(http, "http://gateway", { "fixture" }, {}))
            repo.acceptSnapshot("""{"type":"init","view":{"entries":[]}}""")
            val file = Attachment("file-1", "notes.md", "text/markdown", 10)
            assertFalse(repo.send("a", "Read", listOf(file)))
            advanceTimeBy(60_000); runCurrent()
            assertEquals(1, bodies.size) // No timer or reconnect resends a command.
            assertFalse(repo.send("a", "Read", listOf(file)))
            assertEquals(bodies[0]["requestId"], bodies[1]["requestId"])
            assertEquals("reject", bodies[0].getValue("whenBusy").jsonPrimitive.content)
            assertTrue(bodies[0].getValue("requestId").jsonPrimitive.content.isNotBlank())
            assertFalse(repo.send("b", "Read", listOf(file)))
            assertNotEquals(bodies[1]["requestId"], bodies[2]["requestId"])
            assertFalse(repo.send("a", "Edited", listOf(file)))
            assertNotEquals(bodies[1]["requestId"], bodies[3]["requestId"])
            assertFalse(repo.send("a", "Edited", listOf(file.copy(id = "file-2"))))
            assertNotEquals(bodies[3]["requestId"], bodies[4]["requestId"])
            assertFalse(repo.send("a", "Edited", listOf(file.copy(id = "file-2", name = "renamed.md"))))
            assertEquals(bodies[4]["requestId"], bodies[5]["requestId"])
        } finally { http.close() }
    }

    @Test fun confirmedDeliveryDoesNotReuseIdentityForANewIdenticalMessage() = runTest {
        val ids = mutableListOf<String>()
        val http = HttpClient(MockEngine { request ->
            ids += Json.parseToJsonElement((request.body as TextContent).text).jsonObject.getValue("requestId").jsonPrimitive.content
            respond("{}", HttpStatusCode.OK, headersOf(HttpHeaders.ContentType, "application/json"))
        })
        try {
            val repo = GatewayChatRepository(GatewayApi(http, "http://gateway", { "fixture" }, {}))
            repo.acceptSnapshot("""{"type":"init","view":{"entries":[]}}""")
            assertTrue(repo.send("a", "Again"))
            repo.acceptSnapshot("""{"type":"update","view":{"entries":[{"id":1,"kind":"pi.user","model":[{"content":"Again"}]}]}}""")
            assertTrue(repo.send("a", "Again"))
            assertNotEquals(ids[0], ids[1])
        } finally { http.close() }
    }

    @Test fun sameTextFromAnotherDeviceDoesNotConfirmAnUncertainSend() = runTest {
        val ids = mutableListOf<String>()
        val reached = CompletableDeferred<Unit>()
        val release = CompletableDeferred<Unit>()
        val http = HttpClient(MockEngine { request ->
            ids += Json.parseToJsonElement((request.body as TextContent).text).jsonObject.getValue("requestId").jsonPrimitive.content
            reached.complete(Unit)
            release.await()
            if (ids.size == 1) respond("{}", HttpStatusCode.ServiceUnavailable)
            else respond("""{"result":{"entry":1}}""", HttpStatusCode.OK)
        })
        try {
            val repo = GatewayChatRepository(GatewayApi(http, "http://gateway", { "fixture" }, {}))
            repo.acceptSnapshot("""{"type":"init","view":{"entries":[]}}""")
            val sending = async { repo.send("a", "Again") }
            reached.await()
            repo.acceptSnapshot("""{"type":"update","view":{"entries":[{"id":1,"kind":"pi.user","model":[{"content":"Again"}]}]}}""")
            release.complete(Unit)
            assertFalse(sending.await())
            assertTrue(repo.send("a", "Again"))
            assertEquals(ids[0], ids[1])
            assertFalse(repo.state.value.sending)
            assertEquals(listOf("1"), repo.state.value.projection.messages.map { it.id })
        } finally { http.close() }
    }

    @Test fun lateSettlementPreservesNewDraftsAndConversationScopedUploads() = runTest {
        Dispatchers.setMain(StandardTestDispatcher(testScheduler))
        try {
            for (success in listOf(true, false)) {
                val settlement = CompletableDeferred<Boolean>()
                val sent = mutableListOf<Pair<String, List<Attachment>>>()
                fun repository() = object : ChatRepository {
                    override val state = MutableStateFlow(ConversationState(connection = ConnectionStatus.Online))
                    override suspend fun connect(id: String) = Unit
                    override suspend fun send(id: String, message: String, attachments: List<Attachment>): Boolean {
                        sent += id to attachments
                        return settlement.await()
                    }
                }
                val artifacts = object : ArtifactRepository {
                    override suspend fun capabilities() = ArtifactCapabilities(true, SUPPORTED_MIME_TYPES)
                    override suspend fun upload(uri: String, capabilities: ArtifactCapabilities) = Attachment(uri, "$uri.md", "text/markdown", 10)
                    override suspend fun download(file: Attachment, destination: String) = Unit
                }
                val a = ChatViewModel("a", repository(), artifacts)
                val b = ChatViewModel("b", repository(), artifacts)
                val collectors = listOf(a, b).map { vm -> backgroundScope.launch(UnconfinedTestDispatcher(testScheduler)) { vm.uiState.collect() } }
                a.connect(); b.connect(); runCurrent()
                a.addFiles(listOf("file-a")); b.addFiles(listOf("file-b"))
                a.editDraft("Original"); b.editDraft("Other conversation"); runCurrent()
                a.send(); a.send(); runCurrent()
                assertEquals(1, sent.size)
                assertEquals("a", sent.single().first)
                assertEquals(listOf("file-a"), sent.single().second.map { it.id })
                a.editDraft("New draft"); runCurrent()
                settlement.complete(success); runCurrent()
                assertEquals("New draft", a.uiState.value.draft)
                assertEquals("Other conversation", b.uiState.value.draft)
                assertEquals(listOf("file-b"), b.uiState.value.attachments.files.map { it.file?.id })
                assertEquals(if (success) emptyList<String>() else listOf("file-a"), a.uiState.value.attachments.files.map { it.file?.id })
                collectors.forEach { it.cancel() }
            }
        } finally { Dispatchers.resetMain() }
    }
}
