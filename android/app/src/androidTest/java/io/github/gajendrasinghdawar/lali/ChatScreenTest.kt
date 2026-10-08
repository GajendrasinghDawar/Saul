package io.github.gajendrasinghdawar.lali

import android.graphics.Bitmap
import androidx.activity.ComponentActivity
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.runtime.mutableStateOf
import io.github.gajendrasinghdawar.lali.theme.LaliTheme
import io.github.gajendrasinghdawar.lali.data.chat.*
import io.github.gajendrasinghdawar.lali.feature.chat.*
import io.github.gajendrasinghdawar.lali.ui.components.ConnectionStatus
import io.github.gajendrasinghdawar.lali.ui.shell.*
import java.io.File
import org.junit.*

class ChatScreenTest {
    @get:Rule val compose = createAndroidComposeRule<ComponentActivity>()
    @Test fun thinkingDisclosureToolsAndScrollableCode() {
        val codeLine = "val result = notes.search(query = \"${"weekend plans ".repeat(20)}\")"
        val message = ChatMessage("12", MessageRole.Assistant, "A small example:\n\n```kotlin\n$codeLine\n```", thinking = "Search the notes before answering.", tools = listOf(
            ToolActivity("a", "search", "{\"query\":\"weekend\"}", ToolStatus.Done),
            ToolActivity("b", "read", "{\"path\":\"notes.md\"}", ToolStatus.Running),
        ))
        val state = mutableStateOf(ChatUiState(ConversationState(ChatProjection(listOf(message)), ConnectionStatus.Online)))
        compose.setContent { LaliTheme {
            AppShell(ShellDestination.Conversations, {}, {}, title = "Notes", connection = ConnectionStatus.Online) {
                ChatScreen(state.value, onToggleThinking = { id -> state.value = state.value.copy(thinkingOverrides = mapOf(id to !state.value.thinkingExpanded(message))) })
            }
        } }
        compose.onNodeWithText("Search the notes before answering.").assertDoesNotExist()
        compose.onNodeWithText("Thinking").performClick()
        compose.onNodeWithText("Search the notes before answering.").assertIsDisplayed()
        compose.onNodeWithText("Done").assertExists()
        compose.onNodeWithText("Running").assertExists()
        capture("chat-thinking.png")
        compose.onNodeWithText("Hide thinking").performClick()
        compose.onNodeWithText("Search the notes before answering.").assertDoesNotExist()
        val code = compose.onNodeWithText("val result", substring = true)
        code.performSemanticsAction(SemanticsActions.ScrollBy) { scroll -> scroll(500f, 0f) }
        compose.waitForIdle()
        org.junit.Assert.assertTrue(code.fetchSemanticsNode().config[SemanticsProperties.HorizontalScrollAxisRange].value() > 0f)
        capture("chat-tools.png")
    }

    private fun capture(name: String) {
        File(compose.activity.getExternalFilesDir(null), name).outputStream().use {
            compose.onRoot().captureToImage().asAndroidBitmap().compress(Bitmap.CompressFormat.PNG, 100, it)
        }
    }

    @Test fun composerBlocksEmptyAndBusyAndAcceptsMultiline() {
        val state = mutableStateOf(ChatUiState(ConversationState(connection = ConnectionStatus.Online)))
        var sends = 0
        compose.setContent { LaliTheme { ChatScreen(state.value, { state.value = state.value.copy(draft = it) }, { sends++ }) } }
        compose.onNodeWithText("Send").assertIsNotEnabled()
        compose.onNode(hasSetTextAction()).performTextInput("First line\nSecond line")
        compose.onNodeWithText("Send").assertIsEnabled().performClick()
        org.junit.Assert.assertEquals(1, sends)
        compose.runOnIdle { state.value = state.value.copy(conversation = state.value.conversation.copy(projection = ChatProjection(busy = true))) }
        compose.onNodeWithText("Send").assertIsNotEnabled()
    }
    @Test fun nativeTranscriptAndMarkdown() {
        compose.setContent { LaliTheme {
            AppShell(ShellDestination.Conversations, {}, {}, title = "Weekend plans", connection = ConnectionStatus.Online) {
                ChatScreen(ChatUiState(ConversationState(ChatProjection(listOf(
                    ChatMessage("11", MessageRole.User, "Help me plan the weekend."),
                    ChatMessage("12", MessageRole.Assistant, "## A simple plan\n\nStart with **one priority** and leave time to rest.\n\n- A morning walk\n- Lunch with friends"),
                )), ConnectionStatus.Online)))
            }
        } }
        compose.onNodeWithText("Help me plan the weekend.").assertExists()
        compose.onNodeWithText("A simple plan").assertExists()
        compose.onNodeWithText("A morning walk").assertExists()
        compose.onAllNodesWithText("\u2022").assertCountEquals(2)
        File(compose.activity.getExternalFilesDir(null), "chat.png").outputStream().use {
            compose.onRoot().captureToImage().asAndroidBitmap().compress(Bitmap.CompressFormat.PNG, 100, it)
        }
    }
}
