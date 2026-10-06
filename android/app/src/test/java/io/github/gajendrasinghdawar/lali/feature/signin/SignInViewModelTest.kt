package io.github.gajendrasinghdawar.lali.feature.signin

import io.github.gajendrasinghdawar.lali.core.network.GatewayClient
import io.github.gajendrasinghdawar.lali.core.network.GatewayHealth
import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import java.net.ConnectException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Before
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class SignInViewModelTest {
  private val dispatcher = StandardTestDispatcher()

  @Before
  fun setUp() {
    Dispatchers.setMain(dispatcher)
  }

  @After
  fun tearDown() {
    Dispatchers.resetMain()
  }

  @Test
  fun noGatewayUrl_isNotConfigured_andCheckIsIgnored() = runTest(dispatcher) {
    val viewModel = SignInViewModel(gatewayClient = null)
    viewModel.checkGateway()
    advanceUntilIdle()
    assertEquals(SignInUiState(null, GatewayStatus.NotConfigured), viewModel.uiState.value)
  }

  @Test
  fun unreachableGateway_showsCheckingThenUnreachable() = runTest(dispatcher) {
    val client = GatewayClient(HttpClient(MockEngine { throw ConnectException("refused") }), "http://10.0.2.2:3000")
    val viewModel = SignInViewModel(client)
    assertEquals(GatewayStatus.NotChecked, viewModel.uiState.value.gatewayStatus)

    viewModel.checkGateway()
    assertEquals(GatewayStatus.Checking, viewModel.uiState.value.gatewayStatus)

    // Ktor's engine completes the request off the test dispatcher, so await the terminal state.
    val checked = viewModel.uiState.first { it.gatewayStatus is GatewayStatus.Checked }
    assertEquals(SignInUiState("http://10.0.2.2:3000", GatewayStatus.Checked(GatewayHealth.Unreachable)), checked)
  }
}
