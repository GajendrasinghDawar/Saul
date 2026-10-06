package io.github.gajendrasinghdawar.lali

import io.github.gajendrasinghdawar.lali.core.network.GatewayClient
import io.ktor.client.HttpClient
import io.ktor.client.engine.android.Android

class AppContainer(gatewayBaseUrl: String) {
  private val httpClient =
    HttpClient(Android) {
      engine {
        connectTimeout = 5_000
        socketTimeout = 15_000
      }
    }

  /** Null when the build has no Gateway URL configured. */
  val gatewayClient: GatewayClient? = gatewayBaseUrl.takeIf { it.isNotBlank() }?.let { GatewayClient(httpClient, it) }
}
