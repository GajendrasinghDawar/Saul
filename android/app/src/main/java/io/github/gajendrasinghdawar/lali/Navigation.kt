package io.github.gajendrasinghdawar.lali

import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.navigation3.rememberViewModelStoreNavEntryDecorator
import androidx.navigation3.runtime.*
import androidx.navigation3.ui.NavDisplay
import io.github.gajendrasinghdawar.lali.feature.conversations.*
import io.github.gajendrasinghdawar.lali.feature.signin.*
import io.github.gajendrasinghdawar.lali.ui.shell.*
import kotlinx.coroutines.launch

@Composable
fun MainNavigation(container: AppContainer) {
    val token by container.tokenRepository.tokenFlow.collectAsStateWithLifecycle()
    if (token == null) {
        val stack = rememberNavBackStack(SignIn)
        NavDisplay(backStack = stack, onBack = {}, entryProvider = entryProvider {
            entry<SignIn> { SignInScreen(viewModel { SignInViewModel(container.gatewayClient, container.authRepository) }) }
        })
    } else key(token) {
        val stack = rememberNavBackStack(ConversationList)
        val scope = rememberCoroutineScope()
        val current = stack.last()
        val selected = when (current) { Tasks -> ShellDestination.Tasks; Settings -> ShellDestination.Settings; else -> ShellDestination.Conversations }
        AppShell(selected, { destination ->
            stack.clear()
            stack.add(when (destination) {
                ShellDestination.Conversations -> ConversationList
                ShellDestination.Tasks -> Tasks
                ShellDestination.Settings -> Settings
            })
        }, { scope.launch { container.authRepository.signOut() } }, title = if (current is Chat) "Chat" else selected.title,
            onBack = if (current is Chat) ({ stack.removeLastOrNull(); Unit }) else null) {
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
                    entry<Chat> { Text("Conversation #${it.id}") }
                    entry<Tasks> { Text("Tasks") }
                    entry<Settings> { Text("Settings") }
                })
        }
    }
}
