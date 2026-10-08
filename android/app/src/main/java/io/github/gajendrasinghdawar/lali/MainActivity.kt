package io.github.gajendrasinghdawar.lali

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import io.github.gajendrasinghdawar.lali.theme.LaliTheme

class MainActivity : ComponentActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    enableEdgeToEdge()
    val container = (application as LaliApplication).container
    setContent { LaliTheme { MainNavigation(container) } }
  }
}
