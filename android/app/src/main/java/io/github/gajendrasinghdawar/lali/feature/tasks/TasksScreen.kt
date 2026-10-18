package io.github.gajendrasinghdawar.lali.feature.tasks

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.github.gajendrasinghdawar.lali.data.tasks.*
import io.github.gajendrasinghdawar.lali.theme.*
import io.github.gajendrasinghdawar.lali.ui.components.LaliDangerButton
import io.github.gajendrasinghdawar.lali.ui.components.LaliSecondaryButton

@Composable
fun TasksScreen(viewModel: TasksViewModel) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()
    TasksScreen(state, viewModel::refresh, viewModel::abort)
}

@Composable
fun TasksScreen(state: TasksUiState, onRefresh: () -> Unit, onAbort: (String) -> Unit) {
    var confirming by remember { mutableStateOf<TaskSummary?>(null) }
    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.TopCenter) {
        Column(Modifier.widthIn(max = 896.dp).fillMaxSize().padding(16.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                Text("Active tasks", style = MaterialTheme.typography.headlineSmall)
                LaliSecondaryButton(onRefresh, enabled = !state.working, text = "Refresh")
            }
            Text("Work running on your Gateway. Completed work stays in its conversation.", style = MaterialTheme.typography.bodyMedium, color = Slate11)
            state.error?.let {
                OutlinedCard(Modifier.fillMaxWidth(), colors = CardDefaults.outlinedCardColors(containerColor = MaterialTheme.colorScheme.errorContainer)) {
                    Column(Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text("Couldn't update tasks", style = MaterialTheme.typography.titleSmall, color = MaterialTheme.colorScheme.onErrorContainer)
                        Text(it, color = MaterialTheme.colorScheme.onErrorContainer, modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite })
                        Text("Refresh to try again. Existing tasks are kept below.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onErrorContainer)
                    }
                }
            }
            if (state.loading) LinearProgressIndicator(Modifier.fillMaxWidth())
            else if (state.tasks.isEmpty() && state.error == null) {
                OutlinedCard(Modifier.fillMaxWidth(), shape = RoundedCornerShape(16.dp)) {
                    Column(Modifier.padding(24.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text("All quiet for now", style = MaterialTheme.typography.titleMedium)
                        Text("No active tasks", color = Slate11)
                        Text("Tasks appear here when Saul starts work on your Gateway.", style = MaterialTheme.typography.bodyMedium, color = Slate11)
                    }
                }
            }
            LazyColumn(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(12.dp), contentPadding = PaddingValues(bottom = 16.dp)) {
                items(state.tasks, key = { it.id }) { task ->
                    OutlinedCard(Modifier.fillMaxWidth(), shape = RoundedCornerShape(16.dp)) {
                        Column(Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                            Text(if (task.abortRequested) "Abort requested" else task.status.name,
                                style = MaterialTheme.typography.labelLarge,
                                modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite },
                                color = if (task.abortRequested) Amber11 else if (task.status == TaskStatus.Running) Jade11 else Amber11)
                            Text(task.description, style = MaterialTheme.typography.titleMedium)
                            Text(task.kind, style = MaterialTheme.typography.bodySmall, color = Slate11)
                            HorizontalDivider()
                            if (task.abortRequested) Text("The Gateway is stopping this task. Completed work will remain.", style = MaterialTheme.typography.bodySmall, color = Slate11)
                            LaliDangerButton({ confirming = task }, enabled = !state.working && !task.abortRequested, text = "Abort")
                        }
                    }
                }
            }
        }
    }
    confirming?.let { task ->
        AlertDialog(onDismissRequest = { confirming = null }, title = { Text("Abort task?") }, text = { Text("Stop ${task.kind}? Completed work will not be undone.") },
            confirmButton = { LaliDangerButton({ confirming = null; onAbort(task.id) }, text = "Abort task") },
            dismissButton = { TextButton({ confirming = null }) { Text("Cancel") } })
    }
}
