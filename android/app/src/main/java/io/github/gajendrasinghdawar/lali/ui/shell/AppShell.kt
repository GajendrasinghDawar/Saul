package io.github.gajendrasinghdawar.lali.ui.shell

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.drawscope.Stroke
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
    connection: ConnectionStatus = ConnectionStatus.Offline,
    onBack: (() -> Unit)? = null,
    content: @Composable () -> Unit,
) {
    BoxWithConstraints(Modifier.fillMaxSize()) {
        val wide = maxWidth >= 600.dp
        Row(Modifier.fillMaxSize()) {
            if (wide) {
                NavigationRail(containerColor = Slate2) {
                    ShellDestination.entries.forEach { destination ->
                        NavigationRailItem(
                            selected = selected == destination,
                            onClick = { onNavigate(destination) },
                            icon = { NavigationIcon(destination) },
                            label = { Text(destination.title) },
                        )
                    }
                    Spacer(Modifier.weight(1f))
                    TextButton(onClick = onSignOut) { Text("Sign Out") }
                }
            }
            Scaffold(
                modifier = Modifier.weight(1f),
                topBar = {
                    TopAppBar(
                        title = { Text(title, maxLines = 1, style = MaterialTheme.typography.titleMedium, color = Slate12) },
                        navigationIcon = {
                            if (onBack != null) TextButton(onClick = onBack) { Text("Back") }
                        },
                        actions = {
                            StatusIndicator(connection)
                            if (!wide) TextButton(onClick = onSignOut) { Text("Sign Out") }
                        },
                        colors = TopAppBarDefaults.topAppBarColors(containerColor = Slate2),
                    )
                },
                bottomBar = {
                    if (!wide) NavigationBar(containerColor = Slate2) {
                        ShellDestination.entries.forEach { destination ->
                            NavigationBarItem(
                                selected = selected == destination,
                                onClick = { onNavigate(destination) },
                                icon = { NavigationIcon(destination) },
                                label = { Text(destination.title) },
                            )
                        }
                    }
                },
            ) { padding -> Box(Modifier.fillMaxSize().padding(padding)) { content() } }
        }
    }
}

@Composable
private fun NavigationIcon(destination: ShellDestination) {
    val color = MaterialTheme.colorScheme.onSurface
    Canvas(Modifier.size(24.dp)) {
        val stroke = 1.5.dp.toPx()
        when (destination) {
            ShellDestination.Conversations -> {
                drawRect(color, Offset(size.width * .15f, size.height * .15f), Size(size.width * .7f, size.height * .6f), style = Stroke(stroke))
                drawLine(color, Offset(size.width * .15f, size.height * .75f), Offset(size.width * .15f, size.height * .95f), stroke)
            }
            ShellDestination.Tasks -> repeat(3) { row ->
                val y = size.height * (.25f + row * .25f)
                drawCircle(color, stroke, Offset(size.width * .15f, y))
                drawLine(color, Offset(size.width * .35f, y), Offset(size.width * .9f, y), stroke)
            }
            ShellDestination.Settings -> {
                drawCircle(color, size.width * .35f, style = Stroke(stroke))
                drawCircle(color, size.width * .12f, style = Stroke(stroke))
            }
        }
    }
}
