package io.github.gajendrasinghdawar.lali.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable

private val LightColorScheme =
  lightColorScheme(
    primary = Terracotta40,
    secondary = WarmGrey40,
    background = WarmLightBackground,
    surface = WarmLightBackground,
    surfaceVariant = WarmLightSurfaceVariant,
    surfaceContainerHighest = WarmLightSurfaceVariant,
    onBackground = WarmLightOnSurface,
    onSurface = WarmLightOnSurface,
    onSurfaceVariant = WarmLightOnSurfaceVariant,
  )

private val DarkColorScheme =
  darkColorScheme(
    primary = Terracotta80,
    secondary = WarmGrey80,
    background = WarmDarkBackground,
    surface = WarmDarkBackground,
    surfaceVariant = WarmDarkSurfaceVariant,
    surfaceContainerHighest = WarmDarkSurfaceVariant,
    onBackground = WarmDarkOnSurface,
    onSurface = WarmDarkOnSurface,
    onSurfaceVariant = WarmDarkOnSurfaceVariant,
  )

@Composable
fun LaliTheme(darkTheme: Boolean = isSystemInDarkTheme(), content: @Composable () -> Unit) {
  MaterialTheme(
    colorScheme = if (darkTheme) DarkColorScheme else LightColorScheme,
    typography = Typography,
    content = content,
  )
}
