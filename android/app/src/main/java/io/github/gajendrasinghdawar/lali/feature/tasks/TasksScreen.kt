package io.github.gajendrasinghdawar.lali.feature.tasks

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
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
                Text("Active tasks", style = MaterialTheme.typography.titleMedium)
                LaliSecondaryButton(onRefresh, enabled = !state.working, text = "Refresh")
            }
            state.error?.let { Text(it, color = Red11) }
            if (state.loading) LinearProgressIndicator(Modifier.fillMaxWidth())
            else if (state.tasks.isEmpty()) Text("No active tasks", color = Slate11)
            LazyColumn(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                items(state.tasks, key = { it.id }) { task ->
                    OutlinedCard(Modifier.fillMaxWidth()) {
                        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            Text(task.kind, style = MaterialTheme.typography.titleSmall)
                            Text(task.description, style = MaterialTheme.typography.bodyMedium)
                            Text(if (task.abortRequested) "Abort requested" else task.status.name, color = if (task.status == TaskStatus.Running) Jade11 else Amber11)
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
