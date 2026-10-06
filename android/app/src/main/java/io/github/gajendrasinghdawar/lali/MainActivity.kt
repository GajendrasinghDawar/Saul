package io.github.gajendrasinghdawar.lali

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.util.Log
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import io.github.gajendrasinghdawar.lali.theme.LaliTheme

class MainActivity : ComponentActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    handleIntent(intent)

    enableEdgeToEdge()
    val container = (application as LaliApplication).container
    setContent { LaliTheme { MainNavigation(container) } }
  }

  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    handleIntent(intent)
  }

  private fun handleIntent(intent: Intent?) {
    val data: Uri? = intent?.data
    if (data != null && data.scheme == "saul" && data.host == "auth") {
      val token = data.getQueryParameter("token")
      Log.i("MainActivity", "Intercepted saul://auth with token: $token")
      // We will pass this token to the data store in Ticket 3
    }
  }
}
