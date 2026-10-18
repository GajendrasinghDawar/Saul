package io.github.gajendrasinghdawar.lali.feature.chat

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.*
import androidx.lifecycle.repeatOnLifecycle
import io.github.gajendrasinghdawar.lali.core.markdown.MarkdownText
import io.github.gajendrasinghdawar.lali.data.chat.*
import io.github.gajendrasinghdawar.lali.theme.*
import io.github.gajendrasinghdawar.lali.ui.components.ConnectionStatus
import io.github.gajendrasinghdawar.lali.ui.components.LaliPrimaryButton
import java.util.Locale
import kotlinx.coroutines.launch

@Composable
fun ChatScreen(viewModel: ChatViewModel, onConnectionChange: (ConnectionStatus) -> Unit = {}) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()
    LaunchedEffect(state.conversation.connection) { onConnectionChange(state.conversation.connection) }
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    LaunchedEffect(viewModel, lifecycle) { lifecycle.repeatOnLifecycle(Lifecycle.State.STARTED) { viewModel.connect() } }
    val picker = rememberLauncherForActivityResult(ActivityResultContracts.OpenMultipleDocuments()) { uris -> viewModel.addFiles(uris.map { it.toString() }) }
    var exportFile by remember { mutableStateOf<Attachment?>(null) }
    val exporter = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("application/octet-stream")) { uri ->
        exportFile?.let { file -> if (uri != null) viewModel.download(file, uri.toString()) }
        exportFile = null
    }
    ChatScreen(state, viewModel::editDraft, viewModel::send, viewModel::toggleThinking,
        onAttach = { picker.launch(arrayOf("*/*")) }, onRemoveFile = viewModel::removeFile,
        onDownload = { file -> exportFile = file; exporter.launch(file.name) })
}

@Composable
fun ChatScreen(state: ChatUiState, onDraftChange: (String) -> Unit = {}, onSend: () -> Unit = {}, onToggleThinking: (String) -> Unit = {}, onAttach: () -> Unit = {}, onRemoveFile: (String) -> Unit = {}, onDownload: (Attachment) -> Unit = {}) {
    val list = rememberLazyListState()
    val messages = state.conversation.projection.messages
    val scope = rememberCoroutineScope()
    val bottomTolerance = with(LocalDensity.current) { 96.dp.roundToPx() }
    val nearBottom by remember(list, bottomTolerance) { derivedStateOf {
        val layout = list.layoutInfo
        val last = layout.visibleItemsInfo.lastOrNull()
        !list.canScrollForward || (last != null && last.index == layout.totalItemsCount - 1 &&
            last.offset + last.size <= layout.viewportEndOffset + bottomTolerance)
    } }
    var loaded by remember { mutableStateOf(false) }
    val followUpdate = nearBottom && !list.isScrollInProgress
    LaunchedEffect(messages) {
        // Read the existing viewport, not the new snapshot's message count. Readers
        // inspecting earlier content must not be pulled back by each SSE update.
        if (messages.isNotEmpty()) {
            if (!loaded || followUpdate) {
                list.scrollToItem(messages.size)
            }
            loaded = true
        }
    }
    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.TopCenter) {
        Column(Modifier.widthIn(max = 896.dp).fillMaxSize().imePadding().padding(horizontal = 16.dp)) {
            state.conversation.error?.let {
                Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall,
                    modifier = Modifier.fillMaxWidth().padding(vertical = 12.dp))
            }
            Box(Modifier.weight(1f).fillMaxWidth()) {
            if (messages.isEmpty()) Column(Modifier.align(Alignment.Center).widthIn(max = 360.dp).padding(24.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text("SAUL", color = Crimson11, style = MaterialTheme.typography.labelLarge)
                Text("What’s on your mind?", style = MaterialTheme.typography.headlineSmall)
                Text("A question, a plan, or something to think through. Start here.", color = Slate11, style = MaterialTheme.typography.bodyMedium)
            }
            LazyColumn(Modifier.fillMaxSize().testTag("chat-transcript"), state = list,
                contentPadding = PaddingValues(vertical = 16.dp), verticalArrangement = Arrangement.spacedBy(24.dp)) {
                items(messages, key = { it.id }, contentType = { it.role }) { message ->
                    if (message.role == MessageRole.User) Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                        BoxWithConstraints {
                            Column(Modifier.widthIn(max = maxWidth * .85f).background(Slate3, RoundedCornerShape(16.dp, 16.dp, 4.dp, 16.dp)).padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                                if (message.text.isNotEmpty()) Text(message.text, style = MaterialTheme.typography.bodyMedium)
                                message.attachments.forEach { file -> AttachmentRow(file) { onDownload(file) } }
                                if (message.sending) Text("Sending…", color = Slate11, style = MaterialTheme.typography.bodySmall)
                            }
                        }
                    } else Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                        if (message.thinking.isNotBlank()) {
                            val expanded = state.thinkingExpanded(message)
                            Column(Modifier.fillMaxWidth()) {
                                TextButton(onClick = { onToggleThinking(message.id) }, modifier = Modifier.heightIn(min = 48.dp).semantics { stateDescription = if (expanded) "Expanded" else "Collapsed" }) {
                                    Text(if (expanded) "Hide thinking" else "Thinking")
                                    Spacer(Modifier.width(8.dp))
                                    Text(if (expanded) "−" else "+")
                                }
                                if (expanded) Text(message.thinking, style = MaterialTheme.typography.bodySmall, color = Slate11, modifier = Modifier.padding(start = 16.dp, end = 8.dp, bottom = 12.dp))
                            }
                        }
                        MarkdownText(message.text)
                        message.tools.forEach { tool ->
                            var details by remember(tool.id) { mutableStateOf(false) }
                            Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                                HorizontalDivider(color = Slate6)
                                Column(Modifier.fillMaxWidth().heightIn(min = 48.dp).clickable(onClickLabel = "Tool details", onClick = { details = !details })
                                    .semantics { stateDescription = if (details) "Expanded" else "Collapsed" }.padding(vertical = 12.dp)) {
                                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                                    Text(tool.name, modifier = Modifier.weight(1f), style = MaterialTheme.typography.labelLarge)
                                    Text(tool.status.name, style = MaterialTheme.typography.labelMedium, color = when (tool.status) {
                                        ToolStatus.Done, ToolStatus.Running -> Jade11
                                        ToolStatus.Failed -> Red11
                                        ToolStatus.Pending -> Amber11
                                        ToolStatus.Unknown -> Slate11
                                    })
                                    Text(if (details) "  −" else "  +", color = Slate11)
                                }
                                }
                                if (details && tool.parameters.isNotBlank()) Text(tool.parameters.take(240), fontFamily = FontFamily.Monospace, color = Slate11, style = MaterialTheme.typography.bodySmall, maxLines = 3, overflow = TextOverflow.Ellipsis)
                            }
                        }
                        if (!message.complete) Text("Responding…", color = Slate11, style = MaterialTheme.typography.bodySmall)
                    }
                }
                // A small end anchor also brings the end of very tall replies into view.
                item(key = "transcript-end", contentType = "end") { Spacer(Modifier.height(1.dp)) }
            }
            if (messages.isNotEmpty() && !nearBottom) FilledTonalButton(
                onClick = { scope.launch { list.scrollToItem(messages.size) } },
                modifier = Modifier.align(Alignment.BottomCenter).padding(bottom = 8.dp).heightIn(min = 48.dp)) { Text("Latest messages") }
            }
            Column(Modifier.widthIn(max = 768.dp).fillMaxWidth().align(Alignment.CenterHorizontally)
                .padding(bottom = 12.dp).background(Slate3, RoundedCornerShape(16.dp))
                .border(1.dp, Slate6, RoundedCornerShape(16.dp)).padding(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            state.attachments.notice?.let { Text(it, color = Slate11, style = MaterialTheme.typography.bodySmall) }
            state.attachments.files.forEach { row ->
                Row(Modifier.fillMaxWidth().background(Slate3, RoundedCornerShape(8.dp)).padding(8.dp), verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        row.file?.let { AttachmentRow(it) }
                        if (row.uploading) { Text("Uploading file…"); LinearProgressIndicator(Modifier.fillMaxWidth()) }
                        row.error?.let { Text(it, color = Red11, style = MaterialTheme.typography.bodySmall) }
                    }
                    TextButton(onClick = { onRemoveFile(row.key) }, enabled = !state.conversation.sending, modifier = Modifier.heightIn(min = 48.dp)) { Text("Remove") }
                }
            }
            TextField(state.draft, onDraftChange, Modifier.fillMaxWidth(), placeholder = { Text("Message Saul") },
                maxLines = 6, colors = TextFieldDefaults.colors(
                    focusedContainerColor = Slate3, unfocusedContainerColor = Slate3,
                    focusedIndicatorColor = androidx.compose.ui.graphics.Color.Transparent,
                    unfocusedIndicatorColor = androidx.compose.ui.graphics.Color.Transparent))
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                if (state.attachments.capabilities.enabled) {
                    TextButton(onClick = onAttach, modifier = Modifier.heightIn(min = 48.dp), enabled = !state.conversation.sending && state.attachments.files.size < state.attachments.capabilities.maxFilesPerMessage && state.attachments.capabilities.pickerTypes.isNotEmpty()) { Text("Attach file") }
                }
                Spacer(Modifier.weight(1f))
                LaliPrimaryButton(onSend, modifier = Modifier.heightIn(min = 48.dp), enabled = state.canSend, text = "Send")
            }
            if (state.attachments.capabilities.enabled && !state.attachments.capabilities.supportsImages) {
                Text("Images unavailable for this model.", color = Slate11, style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(horizontal = 8.dp))
            }
            }
        }
    }
}

@Composable
private fun AttachmentRow(file: Attachment, onDownload: (() -> Unit)? = null) {
    val size = when {
        file.size < 1024 -> "${file.size} B"
        file.size < 1024 * 1024 -> String.format(Locale.ROOT, "%.1f KiB", file.size / 1024.0)
        else -> String.format(Locale.ROOT, "%.1f MiB", file.size / (1024.0 * 1024))
    }
    Row(Modifier.padding(vertical = 4.dp).background(Slate3, RoundedCornerShape(8.dp))
        .border(1.dp, Slate6, RoundedCornerShape(8.dp))
        .then(if (onDownload != null) Modifier.clickable(onClickLabel = "Download ${file.name}", onClick = onDownload) else Modifier)
        .heightIn(min = 48.dp)
        .padding(horizontal = 12.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        if (onDownload != null) Text("↓", color = Slate10)
        Column(Modifier.weight(1f)) {
            Text(file.name, style = MaterialTheme.typography.bodyMedium, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(size, color = Slate10, style = MaterialTheme.typography.bodySmall)
        }
    }
}
