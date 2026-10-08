package io.github.gajendrasinghdawar.lali

import android.graphics.Bitmap
import androidx.activity.ComponentActivity
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
        compose.onNodeWithText("Rename").performClick()
        compose.onNode(hasSetTextAction()).performTextReplacement("Revised plans")
        compose.onNodeWithText("Save").performClick()
        assertEquals("Revised plans", renamed)
        compose.onNodeWithText("Delete").performClick()
        compose.onNodeWithText("Delete conversation?").assertExists()
        compose.onAllNodesWithText("Delete").onLast().performClick()
        assertEquals("17", deleted)
        compose.waitForIdle()
        File(compose.activity.getExternalFilesDir(null), "conversations.png").outputStream().use {
            compose.onRoot().captureToImage().asAndroidBitmap().compress(Bitmap.CompressFormat.PNG, 100, it)
        }
    }
}
