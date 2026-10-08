package io.github.gajendrasinghdawar.lali

import io.github.gajendrasinghdawar.lali.core.network.*
import io.github.gajendrasinghdawar.lali.data.conversations.*
import io.github.gajendrasinghdawar.lali.feature.conversations.*
import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.*
import io.ktor.http.*
import kotlinx.coroutines.*
import kotlinx.coroutines.test.*
import org.junit.*
import org.junit.Assert.*

@OptIn(ExperimentalCoroutinesApi::class)
class ConversationsTest {
    private val dispatcher = StandardTestDispatcher()
    @Before fun setup() { Dispatchers.setMain(dispatcher) }
    @After fun teardown() { Dispatchers.resetMain() }

    @Test fun repositoryUsesGatewayMethodsAndBearer() = runTest {
        val requests = mutableListOf<String>()
        val http = HttpClient(MockEngine { request ->
            assertEquals("Bearer test-credential", request.headers[HttpHeaders.Authorization])
            requests.add("${request.method.value} ${request.url.encodedPath}")
            respond(when (request.url.encodedPath) {
                "/api/conversations" -> """{"conversations":[{"id":"17","title":"Plan"},{"id":22}]}"""
                "/api/new-thread" -> """{"conversationId":37,"success":true}"""
                else -> """{"success":true}"""
            }, headers = headersOf(HttpHeaders.ContentType, "application/json"))
        })
        val repository = GatewayConversationRepository(GatewayApi(http, "http://gateway", { "test-credential" }, {}))
        assertEquals(listOf("17", "22"), repository.list().map { it.id })
        assertEquals("37", repository.create())
        repository.rename("17", "Renamed")
        repository.delete("17")
        assertEquals(listOf("GET /api/conversations", "POST /api/new-thread", "PATCH /api/conversations/17", "DELETE /api/conversations/17"), requests)
        http.close()
    }

    @Test fun unauthorizedClearsCredentialsAndDoesNotDecodeBody() = runTest {
        var cleared = false
        val http = HttpClient(MockEngine { respond("unauthorized", HttpStatusCode.Unauthorized) })
        val api = GatewayApi(http, "http://gateway", { "expired" }, { cleared = true })
        try { GatewayConversationRepository(api).list(); fail("Expected HTTP failure") }
        catch (e: GatewayException) { assertEquals(401, e.status) }
        assertTrue(cleared)
        http.close()
    }

    @Test fun viewModelReconcilesMutationsAndPreservesListOnFailure() = runTest(dispatcher) {
        val fake = object : ConversationRepository {
            var rows = listOf(ConversationSummary("17", "Plan"))
            var failDelete = true
            override suspend fun list() = rows
            override suspend fun create(): String { rows = rows + ConversationSummary("37", "New"); return "37" }
            override suspend fun rename(id: String, title: String) { rows = rows.map { if (it.id == id) it.copy(title = title) else it } }
            override suspend fun delete(id: String) { if (failDelete) error("offline"); rows = rows.filterNot { it.id == id } }
        }
        val vm = ConversationListViewModel(fake)
        assertTrue(vm.uiState.value.loading)
        advanceUntilIdle()
        vm.rename("17", " Revised "); advanceUntilIdle()
        assertEquals("Revised", vm.uiState.value.conversations.first().title)
        vm.create(); advanceUntilIdle()
        assertEquals("37", vm.uiState.value.createdId)
        vm.delete("17"); advanceUntilIdle()
        assertEquals(2, vm.uiState.value.conversations.size)
        assertNotNull(vm.uiState.value.error)
        fake.failDelete = false
        vm.delete("17"); advanceUntilIdle()
        assertEquals(listOf("37"), vm.uiState.value.conversations.map { it.id })
    }
}
