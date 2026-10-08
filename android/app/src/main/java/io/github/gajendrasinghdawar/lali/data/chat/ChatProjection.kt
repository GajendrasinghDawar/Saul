package io.github.gajendrasinghdawar.lali.data.chat

import kotlinx.serialization.Serializable
import kotlinx.serialization.SerialName
import kotlinx.serialization.json.*

enum class MessageRole { User, Assistant }
data class ChatMessage(val id: String, val role: MessageRole, val text: String, val thinking: String = "", val complete: Boolean = true, val sending: Boolean = false)
data class ChatProjection(val messages: List<ChatMessage> = emptyList(), val busy: Boolean = false)

@Serializable internal data class SnapshotEvent(val type: String, val view: SnapshotView)
@Serializable internal data class SnapshotView(val entries: List<ViewEntry>, val docs: ViewDocs = ViewDocs())
@Serializable internal data class ViewDocs(@SerialName("pi.live") val live: LiveState? = null)
@Serializable internal data class ViewEntry(val id: JsonPrimitive, val kind: String, val model: List<ModelMessage> = emptyList())
@Serializable internal data class ModelMessage(val content: JsonElement? = null)
@Serializable internal data class LiveState(val run: LiveRun? = null, val generation: Generation? = null)
@Serializable internal data class LiveRun(val taskId: JsonPrimitive)
@Serializable internal data class Generation(val message: ModelMessage? = null)

private val snapshotJson = Json { ignoreUnknownKeys = true }

fun parseSnapshot(data: String): ChatProjection {
    val event = snapshotJson.decodeFromString<SnapshotEvent>(data)
    require(event.type == "init" || event.type == "update") { "Unsupported stream event" }
    val messages = mutableListOf<ChatMessage>()
    var assistantIndex: Int? = null
    fun append(content: JsonElement?) {
        val index = assistantIndex ?: return
        val message = messages[index]
        messages[index] = message.copy(text = message.text + textContent(content), thinking = message.thinking + parts(content, "thinking", "thinking"))
    }
    event.view.entries.forEach { entry ->
        when (entry.kind) {
            "pi.user" -> {
                messages.add(ChatMessage(entry.id.content, MessageRole.User, entry.model.joinToString("") { textContent(it.content) }))
                assistantIndex = null
            }
            "pi.assistant" -> {
                if (assistantIndex == null) {
                    assistantIndex = messages.size
                    messages.add(ChatMessage(entry.id.content, MessageRole.Assistant, ""))
                }
                entry.model.forEach { append(it.content) }
            }
        }
    }
    val live = event.view.docs.live
    val busy = live?.run != null
    if (busy) {
        if (assistantIndex == null) {
            assistantIndex = messages.size
            messages.add(ChatMessage("live-${live?.run?.taskId?.content}", MessageRole.Assistant, ""))
        }
        append(live?.generation?.message?.content)
        assistantIndex?.let { messages[it] = messages[it].copy(complete = false) }
    }
    return ChatProjection(messages.toList(), busy)
}

private fun parts(content: JsonElement?, type: String, field: String): String =
    (content as? JsonArray)?.joinToString("") { value ->
        val part = value as? JsonObject
        if ((part?.get("type") as? JsonPrimitive)?.content == type) (part[field] as? JsonPrimitive)?.contentOrNull.orEmpty() else ""
    }.orEmpty()

private fun textContent(content: JsonElement?): String =
    if (content is JsonPrimitive && content.isString) content.content else parts(content, "text", "text")
