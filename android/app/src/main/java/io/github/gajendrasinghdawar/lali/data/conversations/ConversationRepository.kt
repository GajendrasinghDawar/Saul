package io.github.gajendrasinghdawar.lali.data.conversations

import io.github.gajendrasinghdawar.lali.core.network.GatewayApi
import io.ktor.http.HttpMethod
import io.ktor.http.encodeURLPathPart
import kotlinx.serialization.json.*

data class ConversationSummary(val id: String, val title: String, val preview: String? = null, val timestamp: String? = null)

interface ConversationRepository {
    suspend fun list(): List<ConversationSummary>
    suspend fun create(): String
    suspend fun rename(id: String, title: String)
    suspend fun delete(id: String)
}

class GatewayConversationRepository(private val api: GatewayApi) : ConversationRepository {
    override suspend fun list(): List<ConversationSummary> =
        api.request(HttpMethod.Get, "/api/conversations").getValue("conversations").jsonArray.map { value ->
            val item = value.jsonObject
            val id = item.getValue("id").jsonPrimitive.content
            ConversationSummary(id, item["title"]?.jsonPrimitive?.contentOrNull ?: "New conversation",
                item["preview"]?.jsonPrimitive?.contentOrNull, item["updated"]?.jsonPrimitive?.contentOrNull)
        }

    override suspend fun create(): String = api.request(HttpMethod.Post, "/api/new-thread")
        .getValue("conversationId").jsonPrimitive.content

    override suspend fun rename(id: String, title: String) {
        api.request(HttpMethod.Patch, "/api/conversations/${id.encodeURLPathPart()}", buildJsonObject { put("title", title) })
    }

    override suspend fun delete(id: String) {
        api.request(HttpMethod.Delete, "/api/conversations/${id.encodeURLPathPart()}")
    }
}
