package io.github.gajendrasinghdawar.lali

import android.app.Application

class LaliApplication : Application() {
  val container: AppContainer by lazy { AppContainer(this, BuildConfig.GATEWAY_BASE_URL) }
}
