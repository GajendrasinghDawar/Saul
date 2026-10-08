package io.github.gajendrasinghdawar.lali

import android.os.Bundle
import android.os.Build
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.ui.graphics.toArgb
import io.github.gajendrasinghdawar.lali.theme.LaliTheme
import io.github.gajendrasinghdawar.lali.theme.Slate2

class MainActivity : ComponentActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    enableEdgeToEdge(
      statusBarStyle = SystemBarStyle.dark(android.graphics.Color.TRANSPARENT),
      navigationBarStyle = SystemBarStyle.dark(Slate2.toArgb()),
    )
    if (Build.VERSION.SDK_INT >= 29) window.isNavigationBarContrastEnforced = false
    val container = (application as LaliApplication).container
    setContent { LaliTheme { MainNavigation(container) } }
  }
}
