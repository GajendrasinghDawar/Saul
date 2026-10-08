package io.github.gajendrasinghdawar.lali.feature.chat

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.*
import androidx.lifecycle.repeatOnLifecycle
import io.github.gajendrasinghdawar.lali.core.markdown.MarkdownText
import io.github.gajendrasinghdawar.lali.data.chat.*
import io.github.gajendrasinghdawar.lali.theme.Slate3
import io.github.gajendrasinghdawar.lali.ui.components.StatusIndicator
import io.github.gajendrasinghdawar.lali.ui.components.LaliInput
import io.github.gajendrasinghdawar.lali.ui.components.LaliPrimaryButton

@Composable
fun ChatScreen(viewModel: ChatViewModel) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    LaunchedEffect(viewModel, lifecycle) { lifecycle.repeatOnLifecycle(Lifecycle.State.STARTED) { viewModel.connect() } }
    ChatScreen(state, viewModel::editDraft, viewModel::send)
}

@Composable
fun ChatScreen(state: ChatUiState, onDraftChange: (String) -> Unit = {}, onSend: () -> Unit = {}) {
    val list = rememberLazyListState()
    val messages = state.conversation.projection.messages
    LaunchedEffect(messages) {
        if (messages.isNotEmpty()) list.animateScrollToItem(messages.lastIndex)
    }
    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.TopCenter) {
        Column(Modifier.widthIn(max = 896.dp).fillMaxSize().imePadding().padding(horizontal = 16.dp)) {
            StatusIndicator(state.conversation.connection)
            state.conversation.error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
            if (messages.isEmpty()) Text("Start a conversation with Saul", modifier = Modifier.padding(vertical = 24.dp))
            LazyColumn(Modifier.weight(1f).fillMaxWidth(), state = list,
                contentPadding = PaddingValues(vertical = 16.dp), verticalArrangement = Arrangement.spacedBy(24.dp)) {
                items(messages, key = { it.id }) { message ->
                    if (message.role == MessageRole.User) Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                        BoxWithConstraints {
                            Column(Modifier.widthIn(max = maxWidth * .85f).background(Slate3, RoundedCornerShape(12.dp)).padding(12.dp)) {
                                Text(message.text, style = MaterialTheme.typography.bodyMedium)
                                if (message.sending) Text("Sending…", style = MaterialTheme.typography.bodySmall)
                            }
                        }
                    } else Column(Modifier.fillMaxWidth()) {
                        MarkdownText(message.text)
                        if (!message.complete) Text("Responding…", style = MaterialTheme.typography.bodySmall)
                    }
                }
            }
            Row(Modifier.widthIn(max = 768.dp).fillMaxWidth().align(Alignment.CenterHorizontally).padding(vertical = 12.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.Bottom) {
                LaliInput(state.draft, onDraftChange, Modifier.weight(1f), placeholder = "Message Saul")
                LaliPrimaryButton(onSend, enabled = state.canSend, text = "Send")
            }
        }
    }
}
