package io.github.gajendrasinghdawar.lali.data.chat

import kotlinx.serialization.Serializable
import kotlinx.serialization.SerialName
import kotlinx.serialization.json.*

enum class MessageRole { User, Assistant }
enum class ToolStatus { Pending, Running, Done, Failed, Unknown }
data class ToolActivity(val id: String, val name: String, val parameters: String = "", val status: ToolStatus = ToolStatus.Unknown)
data class ChatMessage(val id: String, val role: MessageRole, val text: String, val thinking: String = "", val complete: Boolean = true, val sending: Boolean = false, val tools: List<ToolActivity> = emptyList())
data class ChatProjection(val messages: List<ChatMessage> = emptyList(), val busy: Boolean = false)

@Serializable internal data class SnapshotEvent(val type: String, val view: SnapshotView)
@Serializable internal data class SnapshotView(val entries: List<ViewEntry>, val docs: ViewDocs = ViewDocs())
@Serializable internal data class ViewDocs(@SerialName("pi.live") val live: LiveState? = null)
@Serializable internal data class ViewEntry(val id: JsonPrimitive, val kind: String, val model: List<ModelMessage> = emptyList())
@Serializable internal data class ModelMessage(val content: JsonElement? = null, val toolCallId: String? = null, val isError: Boolean = false)
@Serializable internal data class LiveState(val run: LiveRun? = null, val generation: Generation? = null, val tools: List<ToolSlot> = emptyList())
@Serializable internal data class ToolSlot(val callId: String, val name: String, val status: String)
@Serializable internal data class LiveRun(val taskId: JsonPrimitive)
@Serializable internal data class Generation(val message: ModelMessage? = null)

private val snapshotJson = Json { ignoreUnknownKeys = true }

fun parseSnapshot(data: String): ChatProjection {
    val event = snapshotJson.decodeFromString<SnapshotEvent>(data)
    require(event.type == "init" || event.type == "update") { "Unsupported stream event" }
    val messages = mutableListOf<ChatMessage>()
    var assistantIndex: Int? = null
    fun tool(activity: ToolActivity) {
        val index = assistantIndex ?: return
        val message = messages[index]
        val old = message.tools.find { it.id == activity.id }
        val updated = activity.copy(parameters = activity.parameters.ifEmpty { old?.parameters.orEmpty() })
        messages[index] = message.copy(tools = if (old == null) message.tools + updated else message.tools.map { if (it.id == updated.id) updated else it })
    }
    fun append(content: JsonElement?) {
        val index = assistantIndex ?: return
        val message = messages[index]
        messages[index] = message.copy(text = message.text + textContent(content), thinking = message.thinking + parts(content, "thinking", "thinking"))
        (content as? JsonArray)?.forEach { value ->
            val part = value as? JsonObject ?: return@forEach
            if ((part["type"] as? JsonPrimitive)?.content == "toolCall") {
                val id = (part["id"] as? JsonPrimitive)?.content ?: return@forEach
                tool(ToolActivity(id, (part["name"] as? JsonPrimitive)?.content ?: "Unknown tool", part["arguments"]?.toString().orEmpty()))
            }
        }
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
            "pi.tool-result" -> entry.model.forEach { result ->
                val id = result.toolCallId ?: return@forEach
                val old = assistantIndex?.let { messages[it].tools.find { tool -> tool.id == id } }
                tool(ToolActivity(id, old?.name ?: "Tool result", status = if (result.isError) ToolStatus.Failed else ToolStatus.Done))
            }
        }
    }
    val live = event.view.docs.live
    val busy = live?.run != null
    if (busy) {
        if (assistantIndex == null) {
            assistantIndex = messages.size
            messages.add(ChatMessage("live-${live.run.taskId.content}", MessageRole.Assistant, ""))
        }
        append(live.generation?.message?.content)
        live.tools.forEach { slot ->
            val old = messages[assistantIndex].tools.find { it.id == slot.callId }
            tool(ToolActivity(slot.callId, slot.name, status = if (old?.status == ToolStatus.Failed) ToolStatus.Failed else when (slot.status) {
                "pending" -> ToolStatus.Pending
                "running" -> ToolStatus.Running
                "done" -> ToolStatus.Done
                else -> ToolStatus.Unknown
            }))
        }
        messages[assistantIndex] = messages[assistantIndex].copy(complete = false)
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
