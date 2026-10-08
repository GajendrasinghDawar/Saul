package io.github.gajendrasinghdawar.lali

import androidx.compose.runtime.*
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.navigation3.rememberViewModelStoreNavEntryDecorator
import androidx.navigation3.runtime.*
import androidx.navigation3.ui.NavDisplay
import io.github.gajendrasinghdawar.lali.feature.conversations.*
import io.github.gajendrasinghdawar.lali.feature.signin.*
import io.github.gajendrasinghdawar.lali.feature.chat.*
import io.github.gajendrasinghdawar.lali.feature.tasks.*
import io.github.gajendrasinghdawar.lali.feature.settings.*
import io.github.gajendrasinghdawar.lali.data.chat.GatewayChatRepository
import io.github.gajendrasinghdawar.lali.ui.components.ConnectionStatus
import io.github.gajendrasinghdawar.lali.ui.shell.*

@Composable
fun MainNavigation(container: AppContainer) {
    val token by container.tokenRepository.tokenFlow.collectAsStateWithLifecycle()
    if (token == null) {
        val stack = rememberNavBackStack(SignIn)
        NavDisplay(backStack = stack, onBack = {},
            entryDecorators = listOf(rememberSaveableStateHolderNavEntryDecorator(), rememberViewModelStoreNavEntryDecorator()), entryProvider = entryProvider {
            entry<SignIn> { SignInScreen(viewModel { SignInViewModel(container.gatewayClient, container.authRepository) }) }
        })
    } else key(token) {
        val stack = rememberNavBackStack(ConversationList)
        val current = stack.last()
        var connection by remember(current) { mutableStateOf(ConnectionStatus.Offline) }
        var signOutRequested by remember { mutableStateOf(false) }
        val selected = when (current) { Tasks -> ShellDestination.Tasks; Settings -> ShellDestination.Settings; else -> ShellDestination.Conversations }
        AppShell(selected, { destination ->
            stack.clear()
            stack.add(when (destination) {
                ShellDestination.Conversations -> ConversationList
                ShellDestination.Tasks -> Tasks
                ShellDestination.Settings -> Settings
            })
        }, { stack.clear(); stack.add(Settings); signOutRequested = true }, title = if (current is Chat) "Chat" else selected.title,
            connection = connection, onBack = if (current is Chat) ({ stack.removeLastOrNull() }) else null) {
            NavDisplay(backStack = stack, onBack = { if (stack.size > 1) stack.removeLastOrNull() },
                entryDecorators = listOf(rememberSaveableStateHolderNavEntryDecorator(), rememberViewModelStoreNavEntryDecorator()),
                entryProvider = entryProvider {
                    entry<ConversationList> {
                        val vm = viewModel { ConversationListViewModel(container.conversationRepository) }
                        val state by vm.uiState.collectAsStateWithLifecycle()
                        LaunchedEffect(state.createdId) {
                            state.createdId?.let { stack.add(Chat(it)); vm.openedCreated() }
                        }
                        ConversationListScreen(state, { stack.add(Chat(it)) }, vm::create, vm::refresh, vm::rename, vm::delete)
                    }
                    entry<Chat> { destination ->
                        ChatScreen(viewModel { ChatViewModel(destination.id, GatewayChatRepository(container.api)) }, onConnectionChange = { connection = it })
                    }
                    entry<Tasks> { TasksScreen(viewModel { TasksViewModel(container.taskRepository) }) }
                    entry<Settings> {
                        val vm = viewModel { SettingsViewModel(container.settingsRepository) }
                        LaunchedEffect(signOutRequested) {
                            if (signOutRequested) { signOutRequested = false; vm.signOut() }
                        }
                        SettingsScreen(vm)
                    }
                })
        }
    }
}
