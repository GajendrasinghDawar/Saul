package io.github.gajendrasinghdawar.lali.feature.conversations

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import io.github.gajendrasinghdawar.lali.theme.Slate3
import io.github.gajendrasinghdawar.lali.ui.components.*

@Composable
fun ConversationListScreen(state: ConversationListUiState, onOpen: (String) -> Unit, onCreate: () -> Unit,
    onRefresh: () -> Unit, onRename: (String, String) -> Unit, onDelete: (String) -> Unit) {
    var renameId by rememberSaveable { mutableStateOf<String?>(null) }
    var title by rememberSaveable { mutableStateOf("") }
    var deleteId by rememberSaveable { mutableStateOf<String?>(null) }
    Column(Modifier.fillMaxSize().padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            LaliPrimaryButton(onCreate, enabled = !state.working, text = "New Chat")
            LaliSecondaryButton(onRefresh, enabled = !state.working, text = "Refresh")
        }
        state.error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
        if (state.loading) {
            repeat(4) { Box(Modifier.fillMaxWidth().height(72.dp).background(Slate3, RoundedCornerShape(8.dp))) }
        } else if (state.conversations.isEmpty()) {
            Text("No conversations yet", modifier = Modifier.padding(vertical = 24.dp))
        } else LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            items(state.conversations, key = { it.id }) { conversation ->
                Column(Modifier.fillMaxWidth().background(Slate3, RoundedCornerShape(8.dp)).padding(12.dp)) {
                    Column(Modifier.fillMaxWidth().clickable { onOpen(conversation.id) }.padding(vertical = 8.dp)) {
                        Text(conversation.title, style = MaterialTheme.typography.titleSmall, maxLines = 2, overflow = TextOverflow.Ellipsis)
                        Text(conversation.preview ?: conversation.timestamp ?: "Conversation #${conversation.id}", style = MaterialTheme.typography.bodySmall)
                    }
                    Row {
                        TextButton(enabled = !state.working, onClick = { renameId = conversation.id; title = conversation.title }) { Text("Rename") }
                        TextButton(enabled = !state.working, onClick = { deleteId = conversation.id }) { Text("Delete", color = MaterialTheme.colorScheme.error) }
                    }
                }
            }
        }
    }
    renameId?.let { id ->
        AlertDialog(onDismissRequest = { renameId = null }, title = { Text("Rename conversation") },
            text = { LaliInput(title, { title = it }, placeholder = "Title", singleLine = true) },
            confirmButton = { TextButton(enabled = title.isNotBlank(), onClick = { onRename(id, title); renameId = null }) { Text("Save") } },
            dismissButton = { TextButton(onClick = { renameId = null }) { Text("Cancel") } })
    }
    deleteId?.let { id ->
        AlertDialog(onDismissRequest = { deleteId = null }, title = { Text("Delete conversation?") },
            text = { Text("This removes the conversation from your list.") },
            confirmButton = { LaliDangerButton({ onDelete(id); deleteId = null }, "Delete") },
            dismissButton = { TextButton(onClick = { deleteId = null }) { Text("Cancel") } })
    }
}
