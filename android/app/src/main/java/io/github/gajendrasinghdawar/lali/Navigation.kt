package io.github.gajendrasinghdawar.lali

import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation3.runtime.entryProvider
import androidx.navigation3.runtime.rememberNavBackStack
import androidx.navigation3.ui.NavDisplay
import io.github.gajendrasinghdawar.lali.feature.home.HomeScreen
import io.github.gajendrasinghdawar.lali.feature.signin.SignInScreen
import io.github.gajendrasinghdawar.lali.feature.signin.SignInViewModel

@Composable
fun MainNavigation(container: AppContainer) {
  val token by container.tokenRepository.tokenFlow.collectAsStateWithLifecycle()
  val startDestination = if (token != null) Home else SignIn
  
  val backStack = rememberNavBackStack(startDestination)

  NavDisplay(
    backStack = backStack,
    onBack = { backStack.removeLastOrNull() },
    entryProvider =
      entryProvider {
        entry<SignIn> { SignInScreen(viewModel { SignInViewModel(container.gatewayClient) }) }
        entry<Home> { HomeScreen(container) }
      },
  )
}
