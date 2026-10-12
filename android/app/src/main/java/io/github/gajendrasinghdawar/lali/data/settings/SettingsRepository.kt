package io.github.gajendrasinghdawar.lali.data.settings

import io.github.gajendrasinghdawar.lali.core.auth.AuthRepository
import io.github.gajendrasinghdawar.lali.core.network.GatewayApi
import io.ktor.client.request.*
import io.ktor.client.statement.bodyAsText
import io.ktor.http.HttpMethod
import io.ktor.http.encodeURLPathPart
import kotlinx.serialization.json.*

data class Account(val name: String, val email: String, val role: String = "user")
data class ServerSetting(val name: String, val secret: Boolean, val value: String?, val isSet: Boolean, val applyMode: String, val pendingRestart: Boolean)
data class SettingResult(val applyMode: String, val pendingRestart: Boolean)
interface SettingsRepository {
    val gatewayUrl: String
    suspend fun account(): Account
    suspend fun settings(): List<ServerSetting>
    suspend fun save(name: String, value: String): SettingResult
    suspend fun delete(name: String, password: String): SettingResult
    suspend fun signOut()
}

class GatewaySettingsRepository(private val api: GatewayApi, private val auth: AuthRepository) : SettingsRepository {
    override val gatewayUrl = api.baseUrl
    override suspend fun account(): Account {
        val user = api.request(HttpMethod.Get, "/api/auth/get-session").getValue("user").jsonObject
        return Account(user["name"]?.jsonPrimitive?.contentOrNull.orEmpty(), user.getValue("email").jsonPrimitive.content, user["role"]?.jsonPrimitive?.contentOrNull ?: "user")
    }
    override suspend fun settings(): List<ServerSetting> {
        val response = api.http.get("${api.baseUrl.trimEnd('/')}/api/secrets") { api.authorize(this) }
        api.check(response)
        return Json.parseToJsonElement(response.bodyAsText()).jsonArray.map { element ->
            val row = element.jsonObject
            val secret = when (row.getValue("kind").jsonPrimitive.content) {
                "secret" -> true
                "env" -> false
                else -> error("Unsupported setting kind")
            }
            ServerSetting(row.getValue("name").jsonPrimitive.content, secret,
                if (secret) null else row["value"]?.jsonPrimitive?.contentOrNull,
                row.getValue("isSet").jsonPrimitive.boolean,
                row.getValue("applyMode").jsonPrimitive.content,
                row.getValue("pendingRestart").jsonPrimitive.boolean)
        }
    }
    override suspend fun save(name: String, value: String) = result(api.request(HttpMethod.Post, "/api/secrets", buildJsonObject { put("name", name); put("value", value) }))
    override suspend fun delete(name: String, password: String) = result(api.request(HttpMethod.Delete, "/api/secrets/${name.encodeURLPathPart()}", buildJsonObject { put("password", password) }))
    private fun result(body: JsonObject): SettingResult {
        check(body.getValue("success").jsonPrimitive.boolean)
        return SettingResult(body.getValue("applyMode").jsonPrimitive.content, body.getValue("pendingRestart").jsonPrimitive.boolean)
    }
    override suspend fun signOut() { auth.signOut() }
}
