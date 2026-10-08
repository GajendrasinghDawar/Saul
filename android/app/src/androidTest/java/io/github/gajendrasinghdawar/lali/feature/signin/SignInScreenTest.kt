package io.github.gajendrasinghdawar.lali.feature.signin

import androidx.activity.ComponentActivity
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import io.github.gajendrasinghdawar.lali.core.network.GatewayHealth
import io.github.gajendrasinghdawar.lali.theme.LaliTheme
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
}
