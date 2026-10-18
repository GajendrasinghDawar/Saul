package io.github.gajendrasinghdawar.lali.ui.shell

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import io.github.gajendrasinghdawar.lali.ui.components.ConnectionStatus
import io.github.gajendrasinghdawar.lali.ui.components.StatusIndicator
import io.github.gajendrasinghdawar.lali.theme.Slate2
import io.github.gajendrasinghdawar.lali.theme.Slate12

enum class ShellDestination(val title: String) {
    Conversations("Conversations"), Tasks("Tasks"), Settings("Settings")
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AppShell(
    selected: ShellDestination,
    onNavigate: (ShellDestination) -> Unit,
    onSignOut: () -> Unit,
    title: String = selected.title,
    connection: ConnectionStatus? = null,
    onBack: (() -> Unit)? = null,
    content: @Composable () -> Unit,
) {
    BoxWithConstraints(Modifier.fillMaxSize()) {
        val wide = maxWidth >= 600.dp
        var accountMenu by rememberSaveable { mutableStateOf(false) }
        Row(Modifier.fillMaxSize()) {
            if (wide) {
                NavigationRail(modifier = Modifier.width(120.dp), containerColor = Slate2, header = {
                    Text("S", color = MaterialTheme.colorScheme.primary,
                        style = MaterialTheme.typography.headlineMedium, modifier = Modifier.padding(vertical = 20.dp))
                }) {
                    ShellDestination.entries.forEach { destination ->
                        NavigationRailItem(
                            selected = selected == destination,
                            onClick = { onNavigate(destination) },
                            icon = { NavigationIcon(destination) },
                            label = { Text(destination.title) },
                        )
                    }
                    Spacer(Modifier.weight(1f))
                }
                VerticalDivider(color = MaterialTheme.colorScheme.outlineVariant)
            }
            Scaffold(
                modifier = Modifier.weight(1f),
                topBar = {
                    TopAppBar(
                        title = {
                            Column {
                                Text("SAUL", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                                Text(title, maxLines = 1, overflow = TextOverflow.Ellipsis,
                                    style = MaterialTheme.typography.titleMedium, color = Slate12)
                            }
                        },
                        navigationIcon = {
                            if (onBack != null) IconButton(onClick = onBack) { ShellIcon(ShellGlyph.Back, "Back") }
                        },
                        actions = {
                            connection?.let { StatusIndicator(it) }
                            Box {
                                IconButton(onClick = { accountMenu = true }) { ShellIcon(ShellGlyph.More, "Account menu") }
                                DropdownMenu(expanded = accountMenu, onDismissRequest = { accountMenu = false }) {
                                    DropdownMenuItem(text = { Text("Sign Out") }, onClick = { accountMenu = false; onSignOut() })
                                }
                            }
                        },
                        colors = TopAppBarDefaults.topAppBarColors(containerColor = Slate2),
                    )
                },
                bottomBar = {
                    if (!wide) Column {
                        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                        NavigationBar(containerColor = Slate2, tonalElevation = 0.dp) {
                        ShellDestination.entries.forEach { destination ->
                            NavigationBarItem(
                                selected = selected == destination,
                                onClick = { onNavigate(destination) },
                                icon = { NavigationIcon(destination) },
                                label = { Text(destination.title) },
                            )
                        }
                        }
                    }
                },
            ) { padding -> Box(Modifier.fillMaxSize().padding(padding)) { content() } }
        }
    }
}

@Composable
private fun NavigationIcon(destination: ShellDestination) {
    ShellIcon(when (destination) {
        ShellDestination.Conversations -> ShellGlyph.Chat
        ShellDestination.Tasks -> ShellGlyph.Tasks
        ShellDestination.Settings -> ShellGlyph.Settings
    }, null)
}

internal enum class ShellGlyph { Chat, Tasks, Settings, Back, More, Refresh }

// Small bundled vectors avoid a dependency on the extended Material icon library.
@Composable
internal fun ShellIcon(glyph: ShellGlyph, description: String?) {
    val vector = remember(glyph) {
        ImageVector.Builder(glyph.name, 24.dp, 24.dp, 24f, 24f).apply {
            path(fill = SolidColor(Color.Black)) {
                when (glyph) {
                    ShellGlyph.Chat -> {
                        moveTo(4f, 3f); horizontalLineTo(20f); curveTo(21.1f, 3f, 22f, 3.9f, 22f, 5f)
                        verticalLineTo(17f); curveTo(22f, 18.1f, 21.1f, 19f, 20f, 19f)
                        horizontalLineTo(6f); lineTo(2f, 23f); verticalLineTo(5f)
                        curveTo(2f, 3.9f, 2.9f, 3f, 4f, 3f); close()
                        moveTo(4f, 5f); verticalLineTo(18.2f); lineTo(5.2f, 17f)
                        horizontalLineTo(20f); verticalLineTo(5f); close()
                    }
                    ShellGlyph.Back -> { moveTo(20f, 11f); horizontalLineTo(7.8f); lineTo(13.4f, 5.4f); lineTo(12f, 4f); lineTo(4f, 12f); lineTo(12f, 20f); lineTo(13.4f, 18.6f); lineTo(7.8f, 13f); horizontalLineTo(20f); close() }
                    ShellGlyph.More -> repeat(3) { i ->
                        val y = 4f + i * 6f
                        moveTo(14f, y + 2f); arcTo(2f, 2f, 0f, true, true, 10f, y + 2f); arcTo(2f, 2f, 0f, true, true, 14f, y + 2f); close()
                    }
                    ShellGlyph.Tasks -> repeat(3) { i ->
                        val y = 4f + i * 6f
                        moveTo(3f, y); horizontalLineTo(5f); verticalLineTo(y + 2f); horizontalLineTo(3f); close()
                        moveTo(8f, y); horizontalLineTo(21f); verticalLineTo(y + 2f); horizontalLineTo(8f); close()
                    }
                    ShellGlyph.Settings -> repeat(3) { i ->
                        val y = 4f + i * 6f
                        val x = if (i == 1) 14f else 6f
                        moveTo(3f, y + 1f); horizontalLineTo(21f); verticalLineTo(y + 3f); horizontalLineTo(3f); close()
                        moveTo(x, y - 1f); horizontalLineTo(x + 4f); verticalLineTo(y + 5f); horizontalLineTo(x); close()
                    }
                    ShellGlyph.Refresh -> {
                        moveTo(17.6f, 6.4f); curveTo(14.5f, 3.3f, 9.5f, 3.3f, 6.4f, 6.4f)
                        curveTo(3.3f, 9.5f, 3.3f, 14.5f, 6.4f, 17.6f)
                        curveTo(9.5f, 20.7f, 14.5f, 20.7f, 17.6f, 17.6f)
                        lineTo(16.2f, 16.2f); curveTo(13.9f, 18.5f, 10.1f, 18.5f, 7.8f, 16.2f)
                        curveTo(5.5f, 13.9f, 5.5f, 10.1f, 7.8f, 7.8f)
                        curveTo(10.1f, 5.5f, 13.9f, 5.5f, 16.2f, 7.8f)
                        lineTo(13f, 11f); horizontalLineTo(21f); verticalLineTo(3f); close()
                    }
                }
            }
        }.build()
    }
    Icon(vector, description, modifier = Modifier.size(24.dp))
}
