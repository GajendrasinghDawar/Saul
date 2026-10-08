package io.github.gajendrasinghdawar.lali.data.settings

import io.github.gajendrasinghdawar.lali.core.auth.AuthRepository
import io.github.gajendrasinghdawar.lali.core.network.GatewayApi
import io.ktor.http.HttpMethod
import kotlinx.serialization.json.*

data class Account(val name: String, val email: String)
interface SettingsRepository {
    val gatewayUrl: String
    suspend fun account(): Account
    suspend fun signOut()
}

class GatewaySettingsRepository(private val api: GatewayApi, private val auth: AuthRepository) : SettingsRepository {
    override val gatewayUrl = api.baseUrl
    override suspend fun account(): Account {
        val user = api.request(HttpMethod.Get, "/api/auth/get-session").getValue("user").jsonObject
        return Account(user["name"]?.jsonPrimitive?.contentOrNull.orEmpty(), user.getValue("email").jsonPrimitive.content)
    }
    override suspend fun signOut() { auth.signOut() }
}
