package io.github.gajendrasinghdawar.lali.feature.settings

import android.app.Activity
import android.content.Context
import android.content.ContextWrapper
import android.view.WindowManager
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.DialogProperties
import androidx.compose.ui.window.SecureFlagPolicy
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.github.gajendrasinghdawar.lali.theme.Slate11
import io.github.gajendrasinghdawar.lali.ui.components.LaliDangerButton
import io.github.gajendrasinghdawar.lali.ui.components.LaliSecondaryButton
import io.github.gajendrasinghdawar.lali.data.settings.ServerSetting

@Composable
fun SettingsScreen(viewModel: SettingsViewModel) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()
    DisposableEffect(viewModel) { onDispose { viewModel.leave() } }
    SettingsScreen(state, viewModel::refresh, viewModel::signOut, viewModel::save, viewModel::delete)
}

@Composable
fun SettingsScreen(state: SettingsUiState, onRefresh: () -> Unit, onSignOut: () -> Unit,
    onSave: (String, String) -> Unit = { _, _ -> }, onDelete: (String, String) -> Unit = { _, _ -> }) {
    var editing by remember(state.editVersion, state.signingOut, state.account?.role) { mutableStateOf<ServerSetting?>(null) }
    var deleting by remember(state.editVersion, state.signingOut, state.account?.role) { mutableStateOf(false) }
    val enabled = !state.loading && !state.working && !state.signingOut && !state.denied
    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.TopCenter) {
        Column(Modifier.widthIn(max = 896.dp).fillMaxWidth().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
            Text("Your workspace", style = MaterialTheme.typography.headlineSmall)
            Text("Manage your account, Gateway and this device.", style = MaterialTheme.typography.bodyMedium, color = Slate11)
            if (state.loading) LinearProgressIndicator(Modifier.fillMaxWidth())
            SettingsSection("Account") {
                state.account?.let { account ->
                    Text(account.name, style = MaterialTheme.typography.titleMedium)
                    Text(account.email, color = Slate11)
                }
                LaliSecondaryButton(onRefresh, enabled = enabled || state.denied && !state.loading && !state.signingOut && !state.working, text = "Refresh account")
            }
            SettingsSection("Gateway") {
                Text(state.gatewayUrl, color = Slate11, style = MaterialTheme.typography.bodyMedium)
                Text("Your conversations and tasks are managed by this server.", color = Slate11, style = MaterialTheme.typography.bodySmall)
            }
            state.error?.let {
                Surface(color = MaterialTheme.colorScheme.errorContainer, shape = RoundedCornerShape(12.dp)) {
                    Text(it, Modifier.fillMaxWidth().padding(16.dp).semantics { liveRegion = LiveRegionMode.Polite }, color = MaterialTheme.colorScheme.onErrorContainer)
                }
            }
            state.notice?.let { Text(it, color = Slate11, modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite }) }
            if (state.account?.role == "admin" && !state.denied) {
                SettingsSection("Server settings") {
                Text("Secrets are never displayed. Restart-required changes must be applied by the server administrator.", color = Slate11, style = MaterialTheme.typography.bodySmall)
                if (state.working) LinearProgressIndicator(Modifier.fillMaxWidth())
                state.settings.forEach { setting ->
                    HorizontalDivider()
                    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text(setting.name, style = MaterialTheme.typography.titleSmall)
                        Text(if (setting.secret) { if (setting.isSet) "Secret set" else "Secret not set" } else setting.value ?: "Not set", color = Slate11)
                        Text(if (setting.pendingRestart) "Restart required" else if (setting.applyMode == "live") "Applies live" else "Applies on server restart", color = Slate11, style = MaterialTheme.typography.bodySmall)
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            LaliSecondaryButton({ deleting = false; editing = setting }, enabled = enabled, text = if (setting.isSet) "Replace" else "Set")
                            LaliDangerButton({ deleting = true; editing = setting }, enabled = enabled && setting.isSet, text = "Delete")
                        }
                    }
                }
                }
            }
            SettingsSection("This device") {
                Text("Signing out revokes this session and removes the credential from this device.", style = MaterialTheme.typography.bodyMedium, color = Slate11)
                LaliDangerButton(onSignOut, enabled = !state.signingOut, text = if (state.signingOut) "Signing out" else "Sign out of this device")
            }
        }
    }
    editing?.let { setting ->
        SettingDialog(setting, deleting, state.working, state.error,
            onDismiss = { editing = null },
            onSubmit = { value -> if (deleting) onDelete(setting.name, value) else onSave(setting.name, value) })
    }
}

@Composable
private fun SettingsSection(title: String, content: @Composable ColumnScope.() -> Unit) {
    OutlinedCard(Modifier.fillMaxWidth(), shape = RoundedCornerShape(16.dp),
        colors = CardDefaults.outlinedCardColors(containerColor = MaterialTheme.colorScheme.surface)) {
        Column(Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text(title, style = MaterialTheme.typography.titleSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            content()
        }
    }
}

@Composable
private fun SettingDialog(setting: ServerSetting, deleting: Boolean, working: Boolean, error: String?, onDismiss: () -> Unit, onSubmit: (String) -> Unit) {
    // Deliberately not saveable: credentials exist only while this dialog is composed.
    var draft by remember(setting.name, deleting) { mutableStateOf("") }
    val context = LocalContext.current
    DisposableEffect(context) {
        val window = context.activity()?.window
        val wasSecure = ((window?.attributes?.flags ?: 0) and WindowManager.LayoutParams.FLAG_SECURE) != 0
        window?.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
        onDispose { draft = ""; if (!wasSecure) window?.clearFlags(WindowManager.LayoutParams.FLAG_SECURE) }
    }
    AlertDialog(
        onDismissRequest = { draft = ""; onDismiss() },
        properties = DialogProperties(securePolicy = SecureFlagPolicy.SecureOn),
        title = { Text(if (deleting) "Delete ${setting.name}?" else "Set ${setting.name}") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                if (deleting) Text("This removes the server setting. Confirm with your current account password.")
                OutlinedTextField(draft, { draft = it }, enabled = !working, singleLine = true,
                    label = { Text(if (deleting) "Current password" else "New value") },
                    visualTransformation = PasswordVisualTransformation(), keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password))
                error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
            }
        },
        confirmButton = { TextButton(enabled = !working && draft.isNotBlank(), onClick = { val value = draft; draft = ""; onSubmit(value) }) { Text(if (deleting) "Confirm deletion" else "Save") } },
        dismissButton = { TextButton(onClick = { draft = ""; onDismiss() }) { Text("Cancel") } },
    )
}

private tailrec fun Context.activity(): Activity? = when (this) {
    is Activity -> this
    is ContextWrapper -> baseContext.activity()
    else -> null
}
