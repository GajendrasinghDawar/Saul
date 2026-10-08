package io.github.gajendrasinghdawar.lali.feature.home

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import io.github.gajendrasinghdawar.lali.AppContainer
import io.github.gajendrasinghdawar.lali.ui.shell.AppShell

@Composable
fun HomeScreen(container: AppContainer) {
    AppShell(
        drawerContent = {
            Box(modifier = Modifier.padding(16.dp)) {
                Text("Navigation", style = MaterialTheme.typography.titleLarge)
            }
        },
        listContent = {
            Box(modifier = Modifier.padding(16.dp)) {
                Text("Conversations", style = MaterialTheme.typography.titleLarge)
            }
        },
        detailContent = {
            Scaffold { innerPadding ->
                Box(
                    modifier = Modifier
                        .fillMaxSize()
                        .padding(innerPadding),
                    contentAlignment = Alignment.Center
                ) {
                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                        Text(
                            text = "Welcome to Saul!",
                            style = MaterialTheme.typography.headlineMedium
                        )
                        Text(
                            text = "You are successfully authenticated.",
                            modifier = Modifier.padding(top = 8.dp)
                        )
                        Button(
                            onClick = {
                                container.authRepository.signOut()
                            },
                            modifier = Modifier.padding(top = 24.dp)
                        ) {
                            Text("Log Out")
                        }
                    }
                }
            }
        }
    )
}
