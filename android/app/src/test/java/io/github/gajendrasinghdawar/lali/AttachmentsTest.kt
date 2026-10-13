package io.github.gajendrasinghdawar.lali

import io.github.gajendrasinghdawar.lali.core.network.*
import io.github.gajendrasinghdawar.lali.data.chat.*
import io.github.gajendrasinghdawar.lali.feature.chat.*
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
import java.io.ByteArrayInputStream

@OptIn(ExperimentalCoroutinesApi::class)
class AttachmentsTest {
    private val file = Attachment("file-1", "notes.txt", "text/plain", 3)
    private val capabilities = ArtifactCapabilities(true, SUPPORTED_MIME_TYPES)
    private fun snapshot(text: String = "") = buildJsonObject {
        put("type", "update")
        put("view", buildJsonObject { put("entries", buildJsonArray { add(buildJsonObject {
            put("id", "1"); put("kind", "pi.user")
            put("model", buildJsonArray { add(buildJsonObject { put("content", buildJsonArray {
                add(buildJsonObject { put("type", "text"); put("text", text) })
                add(buildJsonObject { put("type", "text"); put("text", "saul:attachment:" + Json.encodeToString(file)) })
            }) }) })
        }) }) })
    }.toString()

    @Test fun attachmentOnlyPayloadAndSnapshotReconcile() = runTest {
        val http = HttpClient(MockEngine { request ->
            val body = Json.parseToJsonElement((request.body as TextContent).text).jsonObject
            assertEquals("", body.getValue("message").jsonPrimitive.content)
            assertEquals(listOf("file-1"), body.getValue("attachmentIds").jsonArray.map { it.jsonPrimitive.content })
            assertEquals("Bearer fixture", request.headers[HttpHeaders.Authorization])
            respond("{}")
        })
        val repo = GatewayChatRepository(GatewayApi(http, "http://gateway", { "fixture" }, {}))
        repo.acceptSnapshot("""{"type":"init","view":{"entries":[]}}""")
        assertTrue(repo.send("7", "", listOf(file)))
        repo.acceptSnapshot(snapshot())
        assertEquals(1, repo.state.value.projection.messages.size)
        assertEquals(listOf(file), repo.state.value.projection.messages.single().attachments)
        assertEquals("", repo.state.value.projection.messages.single().text)
        assertFalse(repo.state.value.sending)
        assertEquals("Read this", parseSnapshot(snapshot("Read this")).messages.single().text)
        assertEquals("saul:attachment:invalid", parseSnapshot(snapshot("saul:text:saul:attachment:invalid")).messages.single().text)
        assertEquals("", parseSnapshot(snapshot("saul:attachment:invalid")).messages.single().text)
        http.close()
    }

    @Test fun boundedReadsAndUploadValidationAndBearerHeaders() = runTest {
        assertEquals("text/markdown", fileMimeType("notes.md", "text/x-markdown"))
        assertEquals("text/csv", fileMimeType("jobs.csv", "application/vnd.ms-excel"))
        assertEquals("application/json", fileMimeType("jobs.json", null))
        assertEquals("application/pdf", fileMimeType("resume.pdf", "application/pdf"))
        assertEquals(MAX_FILE_BYTES, readBoundedFile(ByteArrayInputStream(ByteArray(MAX_FILE_BYTES)), MAX_FILE_BYTES).size)
        assertTrue(runCatching { readBoundedFile(ByteArrayInputStream(ByteArray(MAX_FILE_BYTES + 1)), MAX_FILE_BYTES) }.exceptionOrNull() is IllegalArgumentException)
        var calls = 0
        val http = HttpClient(MockEngine { request ->
            calls++
            assertEquals("/api/artifacts", request.url.encodedPath)
            assertEquals("Bearer fixture", request.headers[HttpHeaders.Authorization])
            assertEquals("r%C3%A9sum%C3%A9%20notes.txt", request.headers["x-file-name"])
            assertEquals("text/plain", request.headers["x-file-type"])
            assertEquals(ContentType.Application.OctetStream, request.body.contentType)
            if (calls == 1) respond(Json.encodeToString(file)) else respond("{}", HttpStatusCode.PayloadTooLarge)
        })
        val api = GatewayApi(http, "http://gateway", { "fixture" }, {})
        assertEquals(file, uploadArtifact(api, "résumé notes.txt", "text/plain", byteArrayOf(1, 2, 3), capabilities))
        assertTrue(runCatching { uploadArtifact(api, "résumé notes.txt", "text/plain", byteArrayOf(1), capabilities) }.exceptionOrNull() is GatewayException)
        for (mime in listOf("application/pdf", "audio/mpeg", "video/mp4", "image/png")) {
            assertTrue(runCatching { uploadArtifact(api, "bad", mime, byteArrayOf(1), capabilities) }.exceptionOrNull() is IllegalArgumentException)
        }
        assertTrue(runCatching { uploadArtifact(api, "bad", "text/plain", ByteArray(MAX_FILE_BYTES + 1), capabilities) }.exceptionOrNull() is IllegalArgumentException)
        assertEquals(2, calls)
        http.close()
    }

    @Test fun failedSendPreservesDraftFilesAndUploadErrorsAreRemovable() = runTest {
        Dispatchers.setMain(StandardTestDispatcher(testScheduler))
        try {
            var sends = 0
            val repo = object : ChatRepository {
                override val state = MutableStateFlow(ConversationState(connection = ConnectionStatus.Online))
                override suspend fun connect(id: String) = Unit
                override suspend fun send(id: String, message: String, attachments: List<Attachment>): Boolean {
                    sends++; assertEquals(listOf(file), attachments); return false
                }
            }
            val artifacts = object : ArtifactRepository {
                override suspend fun capabilities() = capabilities
                override suspend fun download(file: Attachment, destination: String) = Unit
                override suspend fun upload(uri: String, capabilities: ArtifactCapabilities): Attachment {
                    require(uri != "bad") { "File exceeds the 5 MiB limit." }; return file
                }
            }
            val vm = ChatViewModel("7", repo, artifacts)
            val collector = backgroundScope.launch(UnconfinedTestDispatcher(testScheduler)) { vm.uiState.collect() }
            vm.connect(); runCurrent()
            vm.addFiles(listOf("good")); runCurrent()
            vm.editDraft("Keep this"); vm.send(); runCurrent()
            assertEquals("Keep this", vm.uiState.value.draft)
            assertEquals(file, vm.uiState.value.attachments.files.single().file)
            assertEquals(1, sends)
            vm.addFiles(listOf("bad")); runCurrent()
            assertFalse(vm.uiState.value.canSend)
            assertEquals("File exceeds the 5 MiB limit.", vm.uiState.value.attachments.files.last().error)
            vm.removeFile(vm.uiState.value.attachments.files.last().key); runCurrent()
            assertTrue(vm.uiState.value.canSend)
            vm.addFiles(List(5) { "good" }); runCurrent()
            assertEquals(4, vm.uiState.value.attachments.files.size)
            assertEquals(1, sends) // No automatic resend.
            collector.cancel(); runCurrent()
        } finally { Dispatchers.resetMain() }
    }
}
