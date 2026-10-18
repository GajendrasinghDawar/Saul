package io.github.gajendrasinghdawar.lali.feature.signin

import android.graphics.Bitmap
import androidx.activity.ComponentActivity
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.test.captureToImage
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import io.github.gajendrasinghdawar.lali.core.network.GatewayHealth
import io.github.gajendrasinghdawar.lali.theme.LaliTheme
import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test

class SignInScreenTest {
  @get:Rule val composeTestRule = createAndroidComposeRule<ComponentActivity>()

  @Test
  fun unreachableGateway_isShown_andCanBeCheckedAgain() {
    var checks = 0
    composeTestRule.setContent {
      LaliTheme {
        SignInScreen(
          state = SignInUiState("http://10.0.2.2:3000", GatewayStatus.Checked(GatewayHealth.Unreachable)),
          onCheckGateway = { checks++ },
          onBeginSignIn = {},
          onResetFlow = {},
        )
      }
    }

    composeTestRule.onNodeWithText("http://10.0.2.2:3000").assertExists()
    composeTestRule.onNodeWithText("Could not reach Gateway").assertExists()
    composeTestRule.onNodeWithText("Sign in with Web").assertIsEnabled()
    capture("signin-unreachable.png")
    composeTestRule.onNodeWithText("Check Gateway").assertIsEnabled().performClick()
    assertEquals(1, checks)
  }

  @Test
  fun notConfigured_disablesGatewayCheck() {
    composeTestRule.setContent {
      LaliTheme { SignInScreen(state = SignInUiState(null, GatewayStatus.NotConfigured), onCheckGateway = {}, onBeginSignIn = {}, onResetFlow = {}) }
    }

    composeTestRule.onNodeWithText("Not configured").assertExists()
    composeTestRule.onNodeWithText("Check Gateway").assertIsNotEnabled()
  }

  @Test
  fun waitingForApproval_showsUserCode_withoutPrivateDiagnostics_andCanCancel() {
    var cancellations = 0
    val verificationUri = "https://example.test/device?user_code=ABCD-EFGH"
    composeTestRule.setContent {
      LaliTheme {
        SignInScreen(
          state = SignInUiState("https://example.test", GatewayStatus.Checked(GatewayHealth.Ready),
            AuthFlowState.WaitingForApproval(
              userCode = "ABCD-EFGH", deviceCode = "private-device-code",
              verificationUri = verificationUri, pollAttempt = 1, liveStatus = "private-poll-diagnostic")),
          onCheckGateway = {}, onBeginSignIn = {}, onResetFlow = { cancellations++ },
        )
      }
    }

    composeTestRule.onNodeWithText("Saul").assertExists()
    composeTestRule.onNodeWithText("ABCD-EFGH").assertExists()
    composeTestRule.onNodeWithText(verificationUri, substring = true).assertDoesNotExist()
    composeTestRule.onNodeWithText("private-device-code", substring = true).assertDoesNotExist()
    composeTestRule.onNodeWithText("private-poll-diagnostic", substring = true).assertDoesNotExist()
    composeTestRule.onNodeWithText("Open browser").performScrollTo().assertIsEnabled()
    capture("signin-approval.png")
    composeTestRule.onNodeWithText("Cancel").performScrollTo().performClick()
    assertEquals(1, cancellations)
  }

  @Test
  fun successfulSignIn_doesNotRenderSessionCredential() {
    composeTestRule.setContent {
      LaliTheme {
        SignInScreen(
          state = SignInUiState("https://example.test", GatewayStatus.Checked(GatewayHealth.Ready), AuthFlowState.Success("private-session-credential")),
          onCheckGateway = {}, onBeginSignIn = {}, onResetFlow = {},
        )
      }
    }
    composeTestRule.onNodeWithText("You're signed in").assertExists()
    composeTestRule.onNodeWithText("private-session-credential", substring = true).assertDoesNotExist()
  }

  private fun capture(name: String) {
    File(composeTestRule.activity.getExternalFilesDir(null), name).outputStream().use {
      composeTestRule.onRoot().captureToImage().asAndroidBitmap().compress(Bitmap.CompressFormat.PNG, 100, it)
    }
  }
}
