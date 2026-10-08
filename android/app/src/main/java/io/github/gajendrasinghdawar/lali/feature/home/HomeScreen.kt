package io.github.gajendrasinghdawar.lali.feature.home

import androidx.compose.foundation.layout.*
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import io.github.gajendrasinghdawar.lali.AppContainer
import io.github.gajendrasinghdawar.lali.ui.shell.AppShell
import io.github.gajendrasinghdawar.lali.ui.shell.ShellDestination

@Composable
fun HomeScreen(container: AppContainer) {
    var selected by rememberSaveable { mutableStateOf(ShellDestination.Conversations) }
    AppShell(selected, { selected = it }, container.authRepository::signOut) {
        Column(Modifier.fillMaxSize().padding(16.dp)) {
            Text("Saul")
            Text(selected.title)
        }
    }
}
