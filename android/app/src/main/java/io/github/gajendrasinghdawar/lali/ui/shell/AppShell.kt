package io.github.gajendrasinghdawar.lali.ui.shell

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.width
import androidx.compose.material3.DrawerValue
import androidx.compose.material3.ModalDrawerSheet
import androidx.compose.material3.ModalNavigationDrawer
import androidx.compose.material3.PermanentDrawerSheet
import androidx.compose.material3.PermanentNavigationDrawer
import androidx.compose.material3.rememberDrawerState
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp

/**
 * Structural UI wrapper supporting a Navigation Drawer on phones
 * and an Adaptive layout (List/Detail) on large screens.
 */
@Composable
fun AppShell(
    drawerContent: @Composable () -> Unit,
    listContent: @Composable (() -> Unit)? = null,
    detailContent: @Composable () -> Unit
) {
    BoxWithConstraints(modifier = Modifier.fillMaxSize()) {
        val isWideScreen = maxWidth >= 840.dp
        
        if (isWideScreen) {
            PermanentNavigationDrawer(
                drawerContent = {
                    PermanentDrawerSheet {
                        drawerContent()
                    }
                }
            ) {
                Row(modifier = Modifier.fillMaxSize()) {
                    if (listContent != null) {
                        Box(modifier = Modifier.width(320.dp)) {
                            listContent()
                        }
                    }
                    Box(modifier = Modifier.weight(1f)) {
                        detailContent()
                    }
                }
            }
        } else {
            val drawerState = rememberDrawerState(initialValue = DrawerValue.Closed)
            ModalNavigationDrawer(
                drawerState = drawerState,
                drawerContent = {
                    ModalDrawerSheet {
                        drawerContent()
                    }
                }
            ) {
                Box(modifier = Modifier.fillMaxSize()) {
                    detailContent()
                }
            }
        }
    }
}
