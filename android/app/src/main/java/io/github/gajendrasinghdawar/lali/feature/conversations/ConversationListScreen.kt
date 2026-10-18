package io.github.gajendrasinghdawar.lali.feature.conversations

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.Alignment
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import io.github.gajendrasinghdawar.lali.ui.components.*
import io.github.gajendrasinghdawar.lali.ui.shell.ShellGlyph
import io.github.gajendrasinghdawar.lali.ui.shell.ShellIcon

@Composable
fun ConversationListScreen(state: ConversationListUiState, onOpen: (String) -> Unit, onCreate: () -> Unit,
    onRefresh: () -> Unit, onRename: (String, String) -> Unit, onDelete: (String) -> Unit) {
    var renameId by rememberSaveable { mutableStateOf<String?>(null) }
    var title by rememberSaveable { mutableStateOf("") }
    var deleteId by rememberSaveable { mutableStateOf<String?>(null) }
    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.TopCenter) {
    Column(Modifier.widthIn(max = 840.dp).fillMaxSize().padding(horizontal = 20.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
        Row(Modifier.fillMaxWidth().padding(top = 12.dp), verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Column(Modifier.weight(1f)) {
                Text("Your conversations", style = MaterialTheme.typography.titleLarge)
                Text("Pick up where you left off.", style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            IconButton(onClick = onRefresh, enabled = !state.working && !state.loading) { ShellIcon(ShellGlyph.Refresh, "Refresh") }
        }
        LaliPrimaryButton(onCreate, enabled = !state.working, text = "New Chat", modifier = Modifier.fillMaxWidth())
        if (state.working && state.conversations.isNotEmpty()) {
            LinearProgressIndicator(Modifier.fillMaxWidth())
        }
        state.error?.let { error ->
            Surface(color = MaterialTheme.colorScheme.errorContainer, shape = MaterialTheme.shapes.medium) {
                Column(Modifier.fillMaxWidth().padding(16.dp).semantics { liveRegion = LiveRegionMode.Polite }) {
                    Text(error, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onErrorContainer)
                    TextButton(onClick = onRefresh, enabled = !state.working && !state.loading) { Text("Try again") }
                }
            }
        }
        if (state.loading && state.conversations.isEmpty()) {
            Column(Modifier.fillMaxWidth().weight(1f), horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.Center) {
                CircularProgressIndicator(Modifier.size(28.dp), strokeWidth = 2.dp)
                Text("Loading conversations…", style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 16.dp))
            }
        } else if (state.conversations.isEmpty() && state.error == null) {
            Column(Modifier.fillMaxWidth().weight(1f).padding(24.dp), horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.Center) {
                Surface(shape = CircleShape, color = MaterialTheme.colorScheme.surfaceVariant) {
                    Box(Modifier.padding(20.dp)) { ShellIcon(ShellGlyph.Chat, null) }
                }
                Text("No conversations yet", style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(top = 20.dp))
                Text("Start a new chat with Saul.", style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 8.dp))
            }
        } else LazyColumn(Modifier.weight(1f), contentPadding = PaddingValues(bottom = 20.dp)) {
            items(state.conversations, key = { it.id }) { conversation ->
                var menuOpen by remember { mutableStateOf(false) }
                Row(Modifier.fillMaxWidth().heightIn(min = 80.dp), verticalAlignment = Alignment.CenterVertically) {
                    Row(Modifier.weight(1f).clickable(onClickLabel = "Open conversation") { onOpen(conversation.id) }
                        .padding(vertical = 18.dp), verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                        Surface(shape = MaterialTheme.shapes.medium, color = MaterialTheme.colorScheme.surfaceVariant) {
                            Box(Modifier.padding(10.dp)) { ShellIcon(ShellGlyph.Chat, null) }
                        }
                        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                            Text(conversation.title, style = MaterialTheme.typography.titleSmall, maxLines = 1, overflow = TextOverflow.Ellipsis)
                            Text(conversation.preview?.takeIf { it.isNotBlank() } ?: conversation.timestamp ?: "Conversation #${conversation.id}",
                                style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
                                maxLines = 1, overflow = TextOverflow.Ellipsis)
                        }
                    }
                    Box {
                        IconButton(enabled = !state.working, onClick = { menuOpen = true }) {
                            ShellIcon(ShellGlyph.More, "More options for ${conversation.title}")
                        }
                        DropdownMenu(expanded = menuOpen, onDismissRequest = { menuOpen = false }) {
                            DropdownMenuItem(text = { Text("Rename") }, enabled = !state.working,
                                onClick = { menuOpen = false; renameId = conversation.id; title = conversation.title })
                            DropdownMenuItem(text = { Text("Delete", color = MaterialTheme.colorScheme.error) }, enabled = !state.working,
                                onClick = { menuOpen = false; deleteId = conversation.id })
                        }
                    }
                }
                HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
            }
        }
    }
    }
    renameId?.let { id ->
        AlertDialog(onDismissRequest = { renameId = null }, title = { Text("Rename conversation") },
            text = { LaliInput(title, { title = it }, placeholder = "Title", singleLine = true) },
            confirmButton = { TextButton(enabled = title.isNotBlank() && !state.working, onClick = { onRename(id, title); renameId = null }) { Text("Save") } },
            dismissButton = { TextButton(onClick = { renameId = null }) { Text("Cancel") } })
    }
    deleteId?.let { id ->
        AlertDialog(onDismissRequest = { deleteId = null }, title = { Text("Delete conversation?") },
            text = { Text("This removes the conversation from your list.") },
            confirmButton = { LaliDangerButton({ onDelete(id); deleteId = null }, "Delete", enabled = !state.working) },
            dismissButton = { TextButton(onClick = { deleteId = null }) { Text("Cancel") } })
    }
}
