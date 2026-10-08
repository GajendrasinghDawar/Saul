package io.github.gajendrasinghdawar.lali.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable

private val DarkColorScheme =
  darkColorScheme(
    primary = Crimson9,
    onPrimary = Slate12,
    secondary = Slate10,
    background = Slate2,
    surface = Slate2,
    surfaceVariant = Slate3,
    surfaceContainerHighest = Slate3,
    onBackground = Slate11,
    onSurface = Slate11,
    onSurfaceVariant = Slate10,
    error = Red9,
    onError = Slate12
  )

@Composable
fun LaliTheme(darkTheme: Boolean = true, content: @Composable () -> Unit) {
  // Always enforce dark theme as per guidelines until light theme is approved.
  MaterialTheme(
    colorScheme = DarkColorScheme,
    typography = Typography,
    content = content,
  )
}
