package io.github.gajendrasinghdawar.lali.core.network

import io.ktor.client.HttpClient
import io.ktor.client.request.get
import io.ktor.http.HttpStatusCode
import java.io.IOException

sealed interface GatewayHealth {
  data object Ready : GatewayHealth

  /** Gateway answered 503: it is running but its auth or database configuration is not ready. */
  data object NotReady : GatewayHealth

  data class UnexpectedStatus(val code: Int) : GatewayHealth

  data object Unreachable : GatewayHealth
}

class GatewayClient(private val http: HttpClient, val baseUrl: String) {
  suspend fun checkHealth(): GatewayHealth =
    try {
      val status = http.get("${baseUrl.trimEnd('/')}/health").status
      when (status) {
        HttpStatusCode.OK -> GatewayHealth.Ready
        HttpStatusCode.ServiceUnavailable -> GatewayHealth.NotReady
        else -> GatewayHealth.UnexpectedStatus(status.value)
      }
    } catch (e: IOException) {
      // Connection refused, timeouts, and cleartext blocked by network security config.
      GatewayHealth.Unreachable
    }

  suspend fun fetchSession(): String? =
    try {
      val response = http.get("${baseUrl.trimEnd('/')}/api/auth/get-session")
      if (response.status == HttpStatusCode.OK) {
        "Session Active"
      } else {
        null
      }
    } catch (e: IOException) {
      null
    }
}
