package io.github.gajendrasinghdawar.lali

import android.graphics.Bitmap
import androidx.activity.ComponentActivity
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import io.github.gajendrasinghdawar.lali.theme.LaliTheme
import io.github.gajendrasinghdawar.lali.data.chat.*
import io.github.gajendrasinghdawar.lali.feature.chat.*
import io.github.gajendrasinghdawar.lali.ui.components.ConnectionStatus
import io.github.gajendrasinghdawar.lali.ui.shell.*
import java.io.File
import org.junit.*

class ChatScreenTest {
    @get:Rule val compose = createAndroidComposeRule<ComponentActivity>()
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
