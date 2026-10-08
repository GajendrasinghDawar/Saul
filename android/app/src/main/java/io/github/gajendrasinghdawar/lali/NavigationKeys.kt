package io.github.gajendrasinghdawar.lali

import androidx.navigation3.runtime.NavKey
import kotlinx.serialization.Serializable

@Serializable data object SignIn : NavKey
@Serializable data object ConversationList : NavKey
@Serializable data class Chat(val id: String) : NavKey
@Serializable data object Tasks : NavKey
@Serializable data object Settings : NavKey
