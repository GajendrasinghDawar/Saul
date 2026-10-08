package io.github.gajendrasinghdawar.lali

import io.github.gajendrasinghdawar.lali.core.auth.*
import io.github.gajendrasinghdawar.lali.core.network.*
import io.github.gajendrasinghdawar.lali.data.tasks.*
import io.github.gajendrasinghdawar.lali.data.settings.*
import io.github.gajendrasinghdawar.lali.feature.tasks.*
import io.github.gajendrasinghdawar.lali.feature.settings.*
import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.*
import io.ktor.http.*
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.test.*
import org.junit.*
import org.junit.Assert.*

@OptIn(ExperimentalCoroutinesApi::class)
class TasksSettingsTest {
    private val dispatcher = StandardTestDispatcher()
    @Before fun setup() { Dispatchers.setMain(dispatcher) }
    @After fun teardown() { Dispatchers.resetMain() }

    @Test fun tasksDecodeDurableStateAndAbortWithBearerAndEncodedId() = runTest {
        val requests = mutableListOf<String>()
        val http = HttpClient(MockEngine { request ->
            assertEquals("Bearer fixture", request.headers[HttpHeaders.Authorization])
            requests.add("${request.method.value} ${request.url.encodedPath}")
            respond(if (request.method == HttpMethod.Get) """{"tasks":[
                {"id":"a/b","kind":"pi.run","conversationId":7,"input":{"description":"Prepare a digest"},"state":{"status":"running"},"abortRequested":false},
                {"id":"b","kind":"tool","conversationId":8,"input":{},"state":{"status":"waiting"},"abortRequested":true},
                {"id":"c","kind":"pi.run","conversationId":9,"state":{"status":"terminal","outcome":{"status":"completed"}}}
            ]}""" else """{"success":true}""")
        })
        val repo = GatewayTaskRepository(GatewayApi(http, "http://gateway", { "fixture" }, {}))
        val tasks = repo.list()
        assertEquals(listOf("a/b", "b"), tasks.map { it.id })
        assertEquals("Prepare a digest", tasks[0].description)
        assertEquals(TaskStatus.Waiting, tasks[1].status)
        assertTrue(tasks[1].abortRequested)
        repo.abort("a/b")
        assertEquals(listOf("GET /api/tasks", "POST /api/tasks/a%2Fb/abort"), requests)
        http.close()
    }

    @Test fun abortUsesCanonicalRefreshAndKeepsRowsOnFailure() = runTest(dispatcher) {
        val fake = object : TaskRepository {
            var rows = listOf(TaskSummary("a", "pi.run", "Digest", TaskStatus.Running))
            var fail = true
            var calls = 0
            override suspend fun list() = rows
            override suspend fun abort(id: String) {
                calls++
                if (fail) error("offline")
                rows = rows.map { it.copy(abortRequested = true) }
            }
        }
        val vm = TasksViewModel(fake)
        assertTrue(vm.uiState.value.loading)
        advanceUntilIdle()
        vm.abort("a"); advanceUntilIdle()
        assertNotNull(vm.uiState.value.error)
        assertFalse(vm.uiState.value.tasks.single().abortRequested)
        fake.fail = false
        vm.abort("a"); advanceUntilIdle()
        assertTrue(vm.uiState.value.tasks.single().abortRequested)
        assertNull(vm.uiState.value.error)
        vm.abort("a"); advanceUntilIdle()
        assertEquals(2, fake.calls)
    }

    @Test fun settingsLoadsAccountRetriesAndClearsAccountAfterSignOut() = runTest(dispatcher) {
        val fake = object : SettingsRepository {
            override val gatewayUrl = "http://gateway"
            var fail = true
            var signOuts = 0
            override suspend fun account(): Account { if (fail) error("offline"); return Account("Test User", "user@example.test") }
            override suspend fun signOut() { signOuts++; if (fail) error("offline") }
        }
        val vm = SettingsViewModel(fake)
        advanceUntilIdle()
        assertNotNull(vm.uiState.value.error)
        fake.fail = false
        vm.refresh(); advanceUntilIdle()
        assertEquals("user@example.test", vm.uiState.value.account?.email)
        assertEquals("http://gateway", vm.uiState.value.gatewayUrl)
        fake.fail = true
        vm.signOut(); vm.signOut(); advanceUntilIdle()
        assertEquals(1, fake.signOuts)
        assertNotNull(vm.uiState.value.account)
        assertNotNull(vm.uiState.value.error)
        fake.fail = false
        vm.signOut(); advanceUntilIdle()
        assertNull(vm.uiState.value.account)
        assertNull(vm.uiState.value.error)
    }

    @Test fun remoteRevocationPrecedesLocalClearAndFailureCanRetry() = runTest {
        for (status in listOf(HttpStatusCode.OK, HttpStatusCode.Unauthorized, HttpStatusCode.ServiceUnavailable)) {
            val credentials = object : CredentialStore {
                override val tokenFlow = MutableStateFlow<String?>("fixture")
                override suspend fun save(value: String) { tokenFlow.value = value }
                override suspend fun clear() { tokenFlow.value = null }
            }
            val http = HttpClient(MockEngine { request ->
                assertNotNull(credentials.tokenFlow.value) // Never clear before requesting revocation.
                assertEquals(HttpMethod.Post, request.method)
                assertEquals("/api/auth/sign-out", request.url.encodedPath)
                assertEquals("Bearer fixture", request.headers[HttpHeaders.Authorization])
                respond("""{"success":true}""", status)
            })
            val auth = DefaultAuthRepository(http, credentials, "http://gateway")
            try { auth.signOut(); assertNotEquals(HttpStatusCode.ServiceUnavailable, status) }
            catch (e: GatewayException) { assertEquals(503, e.status) }
            if (status == HttpStatusCode.ServiceUnavailable) assertNotNull(credentials.tokenFlow.value) else assertNull(credentials.tokenFlow.value)
            http.close()
        }
    }

    @Test fun accountRepositoryDoesNotExposeSessionCredentials() = runTest {
        val credentials = object : CredentialStore {
            override val tokenFlow = MutableStateFlow<String?>("fixture")
            override suspend fun save(value: String) { tokenFlow.value = value }
            override suspend fun clear() { tokenFlow.value = null }
        }
        val http = HttpClient(MockEngine { request ->
            assertEquals("/api/auth/get-session", request.url.encodedPath)
            assertEquals("Bearer fixture", request.headers[HttpHeaders.Authorization])
            respond("""{"user":{"name":"Test User","email":"user@example.test"},"session":{"token":"private"}}""")
        })
        val api = GatewayApi(http, "http://gateway", { credentials.tokenFlow.value }, credentials::clear)
        val repo = GatewaySettingsRepository(api, DefaultAuthRepository(http, credentials, "http://gateway"))
        assertEquals(Account("Test User", "user@example.test"), repo.account())
        http.close()
    }
}
