package io.github.gajendrasinghdawar.lali.feature.settings

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.github.gajendrasinghdawar.lali.theme.Slate11
import io.github.gajendrasinghdawar.lali.ui.components.LaliDangerButton
import io.github.gajendrasinghdawar.lali.ui.components.LaliSecondaryButton

@Composable
fun SettingsScreen(viewModel: SettingsViewModel) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()
    SettingsScreen(state, viewModel::refresh, viewModel::signOut)
}

@Composable
fun SettingsScreen(state: SettingsUiState, onRefresh: () -> Unit, onSignOut: () -> Unit) {
    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.TopCenter) {
        Column(Modifier.widthIn(max = 896.dp).fillMaxWidth().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
            Text("Account", style = MaterialTheme.typography.titleMedium)
            if (state.loading) LinearProgressIndicator(Modifier.fillMaxWidth())
            state.account?.let { account ->
                Text(account.name, style = MaterialTheme.typography.titleSmall)
                Text(account.email, color = Slate11)
            }
            HorizontalDivider()
            Text("Gateway", style = MaterialTheme.typography.titleSmall)
            Text(state.gatewayUrl, color = Slate11)
            state.error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
            LaliSecondaryButton(onRefresh, enabled = !state.loading && !state.signingOut, text = "Refresh account")
            Text("Signing out revokes this session and removes the credential from this device.", style = MaterialTheme.typography.bodySmall, color = Slate11)
            LaliDangerButton(onSignOut, enabled = !state.signingOut, text = if (state.signingOut) "Signing out" else "Sign out of this device")
        }
    }
}
