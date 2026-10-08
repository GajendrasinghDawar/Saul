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
  
  if (token != null) {
      val authBackStack = rememberNavBackStack(Home)
      NavDisplay(
          backStack = authBackStack,
          onBack = { authBackStack.removeLastOrNull() },
          entryProvider = entryProvider {
              entry<Home> { HomeScreen(container) }
          }
      )
  } else {
      val unauthBackStack = rememberNavBackStack(SignIn)
      NavDisplay(
          backStack = unauthBackStack,
          onBack = { unauthBackStack.removeLastOrNull() },
          entryProvider = entryProvider {
              entry<SignIn> { SignInScreen(viewModel { SignInViewModel(container.gatewayClient, container.authRepository) }) }
          }
      )
  }
}
