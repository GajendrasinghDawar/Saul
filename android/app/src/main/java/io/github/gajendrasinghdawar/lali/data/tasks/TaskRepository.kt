package io.github.gajendrasinghdawar.lali.data.tasks

import io.github.gajendrasinghdawar.lali.core.network.GatewayApi
import io.ktor.http.HttpMethod
import io.ktor.http.encodeURLPathPart
import kotlinx.serialization.json.*

enum class TaskStatus { Pending, Running, Waiting }
data class TaskSummary(val id: String, val kind: String, val description: String, val status: TaskStatus, val abortRequested: Boolean = false)

interface TaskRepository {
    suspend fun list(): List<TaskSummary>
    suspend fun abort(id: String)
}

class GatewayTaskRepository(private val api: GatewayApi) : TaskRepository {
    override suspend fun list(): List<TaskSummary> = api.request(HttpMethod.Get, "/api/tasks").getValue("tasks").jsonArray.mapNotNull { value ->
        val task = value.jsonObject
        val status = when (task.getValue("state").jsonObject.getValue("status").jsonPrimitive.content) {
            "pending" -> TaskStatus.Pending
            "running" -> TaskStatus.Running
            "waiting" -> TaskStatus.Waiting
            else -> return@mapNotNull null // Completing/terminal tasks cannot be aborted.
        }
        val kind = task.getValue("kind").jsonPrimitive.content
        val input = task["input"] as? JsonObject
        val description = sequenceOf("description", "message", "prompt").mapNotNull { (input?.get(it) as? JsonPrimitive)?.contentOrNull }.firstOrNull()
            ?: "Conversation ${task.getValue("conversationId").jsonPrimitive.content}"
        TaskSummary(task.getValue("id").jsonPrimitive.content, kind, description, status, task["abortRequested"]?.jsonPrimitive?.booleanOrNull == true)
    }

    override suspend fun abort(id: String) {
        api.request(HttpMethod.Post, "/api/tasks/${id.encodeURLPathPart()}/abort")
    }
}
