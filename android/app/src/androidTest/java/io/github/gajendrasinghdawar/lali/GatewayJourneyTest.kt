package io.github.gajendrasinghdawar.lali

import android.graphics.Bitmap
import android.content.ContextWrapper
import androidx.activity.ComponentActivity
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import io.github.gajendrasinghdawar.lali.core.auth.TokenRepository
import io.github.gajendrasinghdawar.lali.theme.LaliTheme
import java.io.File
import java.net.ServerSocket
import java.net.Socket
import java.util.concurrent.CopyOnWriteArrayList
import kotlin.concurrent.thread
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.first
import org.junit.*
import org.junit.Assert.*

/** Real Android HTTP/SSE engine and Keystore against a sanitized, model-free Gateway fixture. */
class GatewayJourneyTest {
    @get:Rule val compose = createAndroidComposeRule<ComponentActivity>()

    @Test fun chatTasksSettingsRevocationAndEncryptedRestart() {
        val context = fixtureContext()
        FixtureGateway().use { gateway ->
            val container = AppContainer(context, gateway.url)
            runBlocking {
                container.tokenRepository.save("fixture-session")
                val bytes = File(context.noBackupFilesDir, "credential.bin").readBytes()
                assertFalse(bytes.toString(Charsets.UTF_8).contains("fixture-session"))
                assertEquals("fixture-session", withTimeout(5_000) { TokenRepository(context).tokenFlow.first { it != null } })
            }
            try {
                compose.setContent { LaliTheme { MainNavigation(container) } }
                waitForText("Fixture chat")
                compose.onNodeWithText("Fixture chat").performClick()
                compose.waitUntil(10_000) { compose.onAllNodesWithText("Online").fetchSemanticsNodes().size == 2 }
                capture("chat-empty.png")
                compose.onNode(hasSetTextAction()).performTextInput("Explain SSE briefly")
                compose.onNodeWithText("Send").performClick()
                waitForText("Snapshots replace the current transcript.")
                compose.onAllNodesWithText("Explain SSE briefly").assertCountEquals(1)
                capture("chat-journey.png")
                compose.onNodeWithText("Tasks").performClick()
                waitForText("Prepare a daily digest")
                capture("tasks.png")
                compose.onNodeWithText("Abort").performClick()
                capture("tasks-abort.png")
                compose.onNodeWithText("Abort task").performClick()
                waitForText("Abort requested")
                compose.onNodeWithText("Abort").assertIsNotEnabled()
                capture("tasks-aborted.png")
                compose.onNodeWithText("Settings").performClick()
                waitForText("user@example.test")
                capture("settings.png")
                gateway.failSignOut = true
                compose.onNodeWithText("Sign out of this device").performClick()
                waitForText("Could not revoke this session. Check your connection and retry sign-out.")
                assertNotNull(container.tokenRepository.tokenFlow.value)
                capture("settings-error.png")
                gateway.failSignOut = false
                compose.onNodeWithText("Sign out of this device").performClick()
                waitForText("Sign in with Web")
                assertTrue(gateway.revoked)
                assertNull(container.tokenRepository.tokenFlow.value)
                assertFalse(File(context.noBackupFilesDir, "credential.bin").exists())
                capture("signed-out.png")
            } finally {
                runBlocking { container.tokenRepository.clear() }
                container.api.http.close()
            }
        }
    }

    @Test fun unauthorizedHttpReplacesAuthenticatedRoot() {
        val context = fixtureContext()
        FixtureGateway(unauthorized = true).use { gateway ->
            val container = AppContainer(context, gateway.url)
            runBlocking { container.tokenRepository.save("expired-fixture") }
            try {
                compose.setContent { LaliTheme { MainNavigation(container) } }
                waitForText("Sign in with Web")
                assertNull(container.tokenRepository.tokenFlow.value)
                compose.onNodeWithText("New Chat").assertDoesNotExist()
            } finally { runBlocking { container.tokenRepository.clear() }; container.api.http.close() }
        }
    }

    private fun fixtureContext() = object : ContextWrapper(compose.activity.applicationContext) {
        override fun getNoBackupFilesDir(): File = File(baseContext.noBackupFilesDir, "gateway-journey").apply { mkdirs() }
    }
    private fun waitForText(text: String) { compose.waitUntil(10_000) { compose.onAllNodesWithText(text).fetchSemanticsNodes().isNotEmpty() } }
    private fun capture(name: String) {
        compose.waitForIdle()
        File(compose.activity.getExternalFilesDir(null), name).outputStream().use {
            compose.onRoot().captureToImage().asAndroidBitmap().compress(Bitmap.CompressFormat.PNG, 100, it)
        }
    }
}

private class FixtureGateway(private val unauthorized: Boolean = false) : AutoCloseable {
    private val server = ServerSocket(0)
    private val sockets = CopyOnWriteArrayList<Socket>()
    val url = "http://127.0.0.1:${server.localPort}"
    @Volatile var revoked = false
    @Volatile var failSignOut = false
    @Volatile private var sent = false
    @Volatile private var aborted = false
    init {
        thread(isDaemon = true, name = "fixture-gateway") {
            while (!server.isClosed) {
                val socket = try { server.accept() } catch (_: java.io.IOException) { break }
                sockets.add(socket)
                thread(isDaemon = true) { socket.use { try { respond(it) } catch (_: java.io.IOException) { } }; sockets.remove(socket) }
            }
        }
    }
    private fun respond(socket: Socket) {
        val reader = socket.getInputStream().bufferedReader()
        val request = reader.readLine().split(' ')
        val path = request[1]
        var length = 0
        var bearer = false
        while (true) {
            val header = reader.readLine() ?: return
            if (header.isEmpty()) break
            if (header.startsWith("Content-Length:", true)) length = header.substringAfter(':').trim().toInt()
            if (header.startsWith("Authorization: Bearer ", true)) bearer = true
        }
        repeat(length) { reader.read() }
        val output = socket.getOutputStream()
        if (!bearer || unauthorized) {
            output.write("HTTP/1.1 401 Unauthorized\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{}".toByteArray()); return
        }
        if (path == "/api/auth/sign-out" && failSignOut) {
            output.write("HTTP/1.1 503 Service Unavailable\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{}".toByteArray()); return
        }
        if (path.startsWith("/api/stream?conversationId=7")) {
            output.write("HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nConnection: close\r\n\r\n".toByteArray())
            output.write("data: {\"type\":\"init\",\"view\":{\"entries\":[]}}\n\n".toByteArray()); output.flush()
            while (!sent && !server.isClosed) Thread.sleep(20)
            if (!server.isClosed) {
                output.write("""data: {"type":"update","view":{"entries":[{"id":11,"kind":"pi.user","model":[{"content":"Explain SSE briefly"}]},{"id":12,"kind":"pi.assistant","model":[{"content":"Snapshots replace the current transcript."}]}]}}

""".toByteArray()); output.flush()
                while (!server.isClosed && !socket.isClosed) Thread.sleep(20)
            }
            return
        }
        val body = when (path) {
            "/api/conversations" -> """{"conversations":[{"id":"7","title":"Fixture chat"}]}"""
            "/api/chat" -> { sent = true; """{"success":true}""" }
            "/api/tasks" -> """{"tasks":[{"id":"a","kind":"pi.run","conversationId":7,"input":{"description":"Prepare a daily digest"},"state":{"status":"running"},"abortRequested":$aborted}]}"""
            "/api/tasks/a/abort" -> { aborted = true; """{"success":true}""" }
            "/api/auth/get-session" -> """{"user":{"name":"Test User","email":"user@example.test"}}"""
            "/api/auth/sign-out" -> { revoked = true; """{"success":true}""" }
            else -> "{}"
        }
        val bytes = body.toByteArray()
        output.write("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: ${bytes.size}\r\nConnection: close\r\n\r\n".toByteArray())
        output.write(bytes); output.flush()
    }
    override fun close() { server.close(); sockets.forEach { it.close() } }
}
