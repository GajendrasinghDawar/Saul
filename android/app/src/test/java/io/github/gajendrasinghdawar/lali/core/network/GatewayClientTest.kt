package io.github.gajendrasinghdawar.lali.core.network

import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.http.HttpStatusCode
import java.net.ConnectException
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Test

class GatewayClientTest {
  private fun clientReturning(status: HttpStatusCode, requestedUrls: MutableList<String> = mutableListOf()) =
    GatewayClient(
      HttpClient(
        MockEngine { request ->
          requestedUrls += request.url.toString()
          respond("", status)
        }
      ),
      baseUrl = "http://10.0.2.2:3000/",
    )

  @Test
  fun ok_isReady_andRequestsHealthPath() = runTest {
    val urls = mutableListOf<String>()
    assertEquals(GatewayHealth.Ready, clientReturning(HttpStatusCode.OK, urls).checkHealth())
    assertEquals(listOf("http://10.0.2.2:3000/health"), urls)
  }

  @Test
  fun serviceUnavailable_isNotReady() = runTest {
    assertEquals(GatewayHealth.NotReady, clientReturning(HttpStatusCode.ServiceUnavailable).checkHealth())
  }

  @Test
  fun otherStatus_isUnexpected() = runTest {
    assertEquals(GatewayHealth.UnexpectedStatus(500), clientReturning(HttpStatusCode.InternalServerError).checkHealth())
  }

  @Test
  fun connectionFailure_isUnreachable() = runTest {
    val client = GatewayClient(HttpClient(MockEngine { throw ConnectException("refused") }), "http://10.0.2.2:3000")
    assertEquals(GatewayHealth.Unreachable, client.checkHealth())
  }
}
