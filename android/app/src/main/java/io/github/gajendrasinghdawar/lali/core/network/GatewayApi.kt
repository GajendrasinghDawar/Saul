package io.github.gajendrasinghdawar.lali.core.network

import io.ktor.client.HttpClient
import io.ktor.client.request.*
import io.ktor.client.statement.HttpResponse
import io.ktor.client.statement.bodyAsText
import io.ktor.http.*
import kotlinx.serialization.json.*

class GatewayException(val status: Int) : Exception("Gateway returned HTTP $status")

class GatewayApi(
    val http: HttpClient,
    val baseUrl: String,
    private val token: () -> String?,
    private val unauthorized: suspend () -> Unit,
) {
    fun authorize(request: HttpRequestBuilder) {
        token()?.let { request.bearerAuth(it) }
    }

    suspend fun check(response: HttpResponse) {
        if (response.status == HttpStatusCode.Unauthorized) unauthorized()
        if (response.status.value !in 200..299) throw GatewayException(response.status.value)
    }

    suspend fun request(method: HttpMethod, path: String, body: JsonObject? = null): JsonObject {
        val response = http.request("${baseUrl.trimEnd('/')}$path") {
            this.method = method
            authorize(this)
            if (body != null) {
                contentType(ContentType.Application.Json)
                setBody(body.toString())
            }
        }
        check(response)
        return Json.parseToJsonElement(response.bodyAsText()).jsonObject
    }
}
