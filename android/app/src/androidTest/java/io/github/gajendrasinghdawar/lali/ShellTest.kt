package io.github.gajendrasinghdawar.lali

import android.graphics.Bitmap
import androidx.activity.ComponentActivity
import androidx.compose.foundation.layout.*
import androidx.compose.material3.Text
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.unit.dp
import io.github.gajendrasinghdawar.lali.theme.LaliTheme
import io.github.gajendrasinghdawar.lali.ui.components.*
import io.github.gajendrasinghdawar.lali.ui.shell.*
import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test

class ShellTest {
    @get:Rule val compose = createAndroidComposeRule<ComponentActivity>()

    @Test fun destinationsAndPrimitives() {
        var selection = ShellDestination.Conversations
        var signedOut = false
        compose.setContent {
            LaliTheme {
                AppShell(ShellDestination.Conversations, { selection = it }, { signedOut = true }, connection = ConnectionStatus.Online) {
                    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                        Text("Saul", style = androidx.compose.material3.MaterialTheme.typography.titleLarge)
                        LaliInput("", {}, placeholder = "Message Saul", modifier = Modifier.fillMaxWidth())
                        LaliPrimaryButton({}, text = "New Chat")
                        LaliSecondaryButton({}, text = "Cancel")
                        LaliDangerButton({}, text = "Delete")
                    }
                }
            }
        }
        compose.onNodeWithText("Tasks").performClick()
        assertEquals(ShellDestination.Tasks, selection)
        compose.onNodeWithText("Sign Out").performClick()
        assertEquals(true, signedOut)
        compose.onNodeWithText("Online").assertExists()
        val file = File(compose.activity.getExternalFilesDir(null), "shell.png")
        file.outputStream().use { compose.onRoot().captureToImage().asAndroidBitmap().compress(Bitmap.CompressFormat.PNG, 100, it) }
    }
}
