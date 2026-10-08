package io.github.gajendrasinghdawar.lali

import io.github.gajendrasinghdawar.lali.data.chat.*
import io.github.gajendrasinghdawar.lali.feature.chat.*
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.test.*
import org.junit.Test
import org.junit.Assert.*

@OptIn(ExperimentalCoroutinesApi::class)
class ChatActivityTest {
    private val entries = """[{"id":1,"kind":"pi.user","model":[{"content":"Find a note"}]},{"id":2,"kind":"pi.assistant","model":[{"content":[{"type":"thinking","thinking":"Check the notes first."},{"type":"toolCall","id":"a","name":"search","arguments":{"query":"weekend"}},{"type":"toolCall","id":"b","name":"read","arguments":{"path":"notes.md"}}]}]}]"""

    @Test fun liveSlotsAndResultsUseCallIdentityNotPosition() {
        val running = parseSnapshot("""{"type":"update","view":{"entries":$entries,"docs":{"pi.live":{"run":{"taskId":"run"},"tools":[{"callId":"b","name":"read","status":"pending"},{"callId":"a","name":"search","status":"running"}]}}}}""")
        val message = running.messages.last()
        assertEquals("Check the notes first.", message.thinking)
        assertEquals(listOf(ToolStatus.Running, ToolStatus.Pending), message.tools.map { it.status })
        assertEquals("""{"query":"weekend"}""", message.tools[0].parameters)
        val results = entries.dropLast(1) + """,{"id":3,"kind":"pi.tool-result","model":[{"toolCallId":"b","isError":true,"content":"Missing"}]},{"id":4,"kind":"pi.tool-result","model":[{"toolCallId":"a","content":"Found"}]},{"id":5,"kind":"pi.assistant","model":[{"content":"Here is the note."}]}]"""
        val final = parseSnapshot("""{"type":"update","view":{"entries":$results}}""").messages.last()
        assertEquals(listOf(ToolStatus.Done, ToolStatus.Failed), final.tools.map { it.status })
        assertEquals("Here is the note.", final.text)
        assertTrue(final.complete)
        assertEquals(2, final.tools.size)
        assertEquals(ToolStatus.Unknown, parseSnapshot("""{"type":"init","view":{"entries":$entries}}""").messages.last().tools.first().status)
    }

    @Test fun thinkingDefaultsFollowCompletionAndToggleIsScopedToMessage() = runTest {
        Dispatchers.setMain(StandardTestDispatcher(testScheduler))
        try {
            val first = ChatMessage("a", MessageRole.Assistant, "", thinking = "Reasoning", complete = false)
            val second = first.copy(id = "b", complete = true)
            val repository = object : ChatRepository {
                override val state = MutableStateFlow(ConversationState(ChatProjection(listOf(first, second))))
                override suspend fun connect(id: String) = Unit
                override suspend fun send(id: String, message: String) = false
            }
            val vm = ChatViewModel("7", repository)
            val collector = backgroundScope.launch(UnconfinedTestDispatcher(testScheduler)) { vm.uiState.collect() }
            runCurrent()
            assertTrue(vm.uiState.value.thinkingExpanded(first))
            assertFalse(vm.uiState.value.thinkingExpanded(second))
            vm.toggleThinking("b"); runCurrent()
            assertTrue(vm.uiState.value.thinkingExpanded(second))
            assertTrue(vm.uiState.value.thinkingExpanded(first))
            repository.state.value = repository.state.value.copy(projection = ChatProjection(listOf(first.copy(complete = true), second)))
            runCurrent()
            assertFalse(vm.uiState.value.thinkingExpanded(first.copy(complete = true)))
            vm.toggleThinking("b"); runCurrent()
            assertFalse(vm.uiState.value.thinkingExpanded(second))
            collector.cancel(); runCurrent()
        } finally { Dispatchers.resetMain() }
    }
}
