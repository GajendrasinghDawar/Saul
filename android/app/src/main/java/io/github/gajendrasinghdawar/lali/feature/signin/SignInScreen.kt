package io.github.gajendrasinghdawar.lali.feature.signin

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.consumeWindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.github.gajendrasinghdawar.lali.core.network.GatewayHealth
import io.github.gajendrasinghdawar.lali.theme.LaliTheme

@Composable
fun SignInScreen(viewModel: SignInViewModel) {
  val state by viewModel.uiState.collectAsStateWithLifecycle()
  SignInScreen(
      state = state, 
      onCheckGateway = viewModel::checkGateway,
      onBeginSignIn = viewModel::beginSignIn,
      onResetFlow = viewModel::resetFlow
  )
}

@Composable
internal fun SignInScreen(
  state: SignInUiState, 
  onCheckGateway: () -> Unit, 
  onBeginSignIn: () -> Unit,
  onResetFlow: () -> Unit
) {
  Scaffold { innerPadding ->
    Column(
      modifier =
        Modifier.fillMaxSize()
          .padding(innerPadding)
          .consumeWindowInsets(innerPadding)
          .verticalScroll(rememberScrollState())
          .padding(24.dp),
      verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
      Text("Lali", style = MaterialTheme.typography.displaySmall)
      Text(
        "Sign in to continue your sessions.",
        style = MaterialTheme.typography.bodyLarge,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
      )

      Card(modifier = Modifier.fillMaxWidth()) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
          Text("Gateway", style = MaterialTheme.typography.titleMedium)
          Text(state.gatewayBaseUrl ?: "Not configured", style = MaterialTheme.typography.bodyMedium)
          Text(
            text = gatewayStatusText(state.gatewayStatus),
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite },
          )
          OutlinedButton(
            onClick = onCheckGateway,
            enabled = state.gatewayStatus != GatewayStatus.NotConfigured && state.gatewayStatus != GatewayStatus.Checking,
          ) {
            Text("Check Gateway")
          }
        }
      }

      // Launch Web Auth via Custom Tab when new code is received
      val context = androidx.compose.ui.platform.LocalContext.current
      androidx.compose.runtime.LaunchedEffect(state.authState) {
          if (state.authState is AuthFlowState.WaitingForApproval && state.authState.pollAttempt == 0) {
              val uri = state.authState.verificationUri
              val intent = androidx.browser.customtabs.CustomTabsIntent.Builder().build()
              intent.launchUrl(context, android.net.Uri.parse(uri))
          }
      }

      // Real-time Auth Diagnostics & Live Interactions
      when (val auth = state.authState) {
        AuthFlowState.Idle -> {
          Button(
            onClick = onBeginSignIn,
            modifier = Modifier.fillMaxWidth(),
          ) {
            Text("Sign in with Web")
          }
          Text(
            "Securely authenticate via your browser.",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
          )
        }
        AuthFlowState.RequestingCode -> {
          Card(modifier = Modifier.fillMaxWidth()) {
            Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
              Text("Requesting Device Authorization...", style = MaterialTheme.typography.titleMedium)
              Text("Contacting Gateway: ${state.gatewayBaseUrl}", style = MaterialTheme.typography.bodySmall)
            }
          }
        }
        is AuthFlowState.WaitingForApproval -> {
          Card(
            modifier = Modifier.fillMaxWidth(),
            colors = androidx.compose.material3.CardDefaults.cardColors(
              containerColor = MaterialTheme.colorScheme.surfaceVariant
            )
          ) {
            Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
              Text("Approval in Progress", style = MaterialTheme.typography.titleMedium)
              
              Column(
                modifier = Modifier
                  .fillMaxWidth()
                  .padding(8.dp),
                horizontalAlignment = androidx.compose.ui.Alignment.CenterHorizontally
              ) {
                Text("Verification Code", style = MaterialTheme.typography.labelSmall)
                Text(
                  auth.userCode,
                  style = MaterialTheme.typography.headlineMedium,
                  color = MaterialTheme.colorScheme.primary,
                  fontWeight = androidx.compose.ui.text.font.FontWeight.Bold
                )
              }

              Text(
                text = "Live Status: ${auth.liveStatus}",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant
              )

              Text(
                text = "Target URL: ${auth.verificationUri}",
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant
              )

              androidx.compose.foundation.layout.Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp)
              ) {
                OutlinedButton(
                  onClick = {
                    val intent = androidx.browser.customtabs.CustomTabsIntent.Builder().build()
                    intent.launchUrl(context, android.net.Uri.parse(auth.verificationUri))
                  },
                  modifier = Modifier.weight(1f)
                ) {
                  Text("Reopen Web")
                }

                OutlinedButton(
                  onClick = onResetFlow,
                  modifier = Modifier.weight(1f)
                ) {
                  Text("Cancel")
                }
              }
            }
          }
        }
        is AuthFlowState.Success -> {
          Card(
            modifier = Modifier.fillMaxWidth(),
            colors = androidx.compose.material3.CardDefaults.cardColors(
              containerColor = MaterialTheme.colorScheme.primaryContainer
            )
          ) {
            Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
              Text("Authenticated!", style = MaterialTheme.typography.titleMedium)
              Text("Session active. Navigating...", style = MaterialTheme.typography.bodySmall)
            }
          }
        }
        is AuthFlowState.Error -> {
          Card(
            modifier = Modifier.fillMaxWidth(),
            colors = androidx.compose.material3.CardDefaults.cardColors(
              containerColor = MaterialTheme.colorScheme.errorContainer
            )
          ) {
            Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
              Text("Authentication Error", style = MaterialTheme.typography.titleMedium, color = MaterialTheme.colorScheme.onErrorContainer)
              Text(auth.message, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onErrorContainer)
              Button(onClick = onBeginSignIn, modifier = Modifier.fillMaxWidth()) {
                Text("Try Again")
              }
            }
          }
        }
      }
    }
  }
}

internal fun gatewayStatusText(status: GatewayStatus): String =
  when (status) {
    GatewayStatus.NotConfigured -> "This build has no Gateway URL."
    GatewayStatus.NotChecked -> "Not checked"
    GatewayStatus.Checking -> "Checking..."
    is GatewayStatus.Checked ->
      when (val health = status.health) {
        GatewayHealth.Ready -> "Gateway reachable"
        GatewayHealth.NotReady -> "Gateway is running but not ready"
        is GatewayHealth.UnexpectedStatus -> "Gateway returned HTTP ${health.code}"
        GatewayHealth.Unreachable -> "Could not reach Gateway"
      }
  }

@Preview(showBackground = true)
@Composable
private fun SignInScreenPreview() {
  LaliTheme {
    SignInScreen(
      state = SignInUiState("http://10.0.2.2:3000", GatewayStatus.Checked(GatewayHealth.Ready)),
      onCheckGateway = {},
      onBeginSignIn = {},
      onResetFlow = {}
    )
  }
}
