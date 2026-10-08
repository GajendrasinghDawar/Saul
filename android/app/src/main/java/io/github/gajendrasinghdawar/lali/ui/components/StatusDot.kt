package io.github.gajendrasinghdawar.lali.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Text
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.Alignment
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import io.github.gajendrasinghdawar.lali.theme.Jade9
import io.github.gajendrasinghdawar.lali.theme.Amber9
import io.github.gajendrasinghdawar.lali.theme.Slate9

enum class ConnectionStatus { Online, Offline, Connecting }

@Composable
fun StatusIndicator(status: ConnectionStatus) {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        StatusDot(when (status) {
            ConnectionStatus.Online -> Jade9
            ConnectionStatus.Connecting -> Amber9
            ConnectionStatus.Offline -> Slate9
        })
        Text(status.name, style = MaterialTheme.typography.labelMedium)
    }
}

@Composable
fun StatusDot(
    color: Color,
    modifier: Modifier = Modifier,
    size: Dp = 8.dp
) {
    Box(
        modifier = modifier
            .size(size)
            .clip(CircleShape)
            .background(color)
    )
}
