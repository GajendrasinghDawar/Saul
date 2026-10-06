package io.github.gajendrasinghdawar.lali

import androidx.compose.runtime.Composable
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation3.runtime.entryProvider
import androidx.navigation3.runtime.rememberNavBackStack
import androidx.navigation3.ui.NavDisplay
import io.github.gajendrasinghdawar.lali.feature.signin.SignInScreen
import io.github.gajendrasinghdawar.lali.feature.signin.SignInViewModel

@Composable
fun MainNavigation(container: AppContainer) {
  val backStack = rememberNavBackStack(SignIn)

  NavDisplay(
    backStack = backStack,
    onBack = { backStack.removeLastOrNull() },
    entryProvider =
      entryProvider {
        entry<SignIn> { SignInScreen(viewModel { SignInViewModel(container.gatewayClient) }) }
      },
  )
}
