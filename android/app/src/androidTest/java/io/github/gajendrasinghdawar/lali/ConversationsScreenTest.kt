package io.github.gajendrasinghdawar.lali

import android.graphics.Bitmap
import androidx.activity.ComponentActivity
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import io.github.gajendrasinghdawar.lali.theme.LaliTheme
import io.github.gajendrasinghdawar.lali.data.conversations.ConversationSummary
import io.github.gajendrasinghdawar.lali.feature.conversations.*
import io.github.gajendrasinghdawar.lali.ui.shell.*
import java.io.File
import org.junit.*
import org.junit.Assert.*

class ConversationsScreenTest {
    @get:Rule val compose = createAndroidComposeRule<ComponentActivity>()
    @Test fun openRenameDeleteAndCapture() {
        var opened = ""
        var renamed = ""
        var deleted = ""
        compose.setContent { LaliTheme {
            AppShell(ShellDestination.Conversations, {}, {}) {
                ConversationListScreen(ConversationListUiState(listOf(ConversationSummary("17", "Weekend plans")), loading = false),
                    { opened = it }, {}, {}, { _, title -> renamed = title }, { deleted = it })
            }
        } }
        compose.onNodeWithText("Weekend plans").performClick()
        assertEquals("17", opened)
        compose.onNodeWithText("Rename").assertDoesNotExist()
        compose.onNodeWithText("Delete").assertDoesNotExist()
        compose.onNodeWithContentDescription("More options for Weekend plans").performClick()
        capture("conversations-menu.png")
        compose.onNodeWithText("Rename").performClick()
        compose.onNode(hasSetTextAction()).performTextReplacement("Revised plans")
        capture("conversations-rename.png")
        compose.onNodeWithText("Save").performClick()
        assertEquals("Revised plans", renamed)
        compose.onNodeWithContentDescription("More options for Weekend plans").performClick()
        compose.onNodeWithText("Delete").performClick()
        compose.onNodeWithText("Delete conversation?").assertExists()
        capture("conversations-delete.png")
        assertEquals("", deleted)
        compose.onNodeWithText("Cancel").performClick()
        assertEquals("", deleted)
        compose.onNodeWithContentDescription("More options for Weekend plans").performClick()
        compose.onNodeWithText("Delete").performClick()
        compose.onAllNodesWithText("Delete").onLast().performClick()
        assertEquals("17", deleted)
        compose.waitForIdle()
        File(compose.activity.getExternalFilesDir(null), "conversations.png").outputStream().use {
            compose.onRoot().captureToImage().asAndroidBitmap().compress(Bitmap.CompressFormat.PNG, 100, it)
        }
    }

    @Test fun emptyStateKeepsCreateAndRetryActions() {
        var created = false
        var refreshed = false
        val state = mutableStateOf(ConversationListUiState(loading = false, error = "Connection unavailable"))
        compose.setContent { LaliTheme {
            AppShell(ShellDestination.Conversations, {}, {}) {
            ConversationListScreen(state.value,
                {}, { created = true }, { refreshed = true }, { _, _ -> }, {})
            }
        } }
        compose.onNodeWithText("No conversations yet").assertDoesNotExist()
        compose.onNodeWithText("Connection unavailable").assertExists()
        capture("conversations-error.png")
        compose.onNodeWithText("New Chat").performClick()
        assertTrue(created)
        compose.onNodeWithText("Try again").performClick()
        assertTrue(refreshed)
        compose.runOnIdle { state.value = state.value.copy(error = null) }
        compose.onNodeWithText("No conversations yet").assertIsDisplayed()
        capture("conversations-empty.png")
    }

    private fun capture(name: String) {
        File(compose.activity.getExternalFilesDir(null), name).outputStream().use {
            compose.onRoot().captureToImage().asAndroidBitmap().compress(Bitmap.CompressFormat.PNG, 100, it)
        }
    }
}
