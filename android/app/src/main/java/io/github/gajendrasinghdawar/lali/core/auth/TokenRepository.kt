package io.github.gajendrasinghdawar.lali.core.auth

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import java.io.File
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow

interface CredentialStore {
    val tokenFlow: kotlinx.coroutines.flow.StateFlow<String?>
    suspend fun save(value: String)
    suspend fun clear()
}

/** Credential ciphertext is excluded from both backup and device transfer. */
class TokenRepository(context: Context) : CredentialStore {
    private val file = File(context.noBackupFilesDir, "credential.bin")
    private val state = MutableStateFlow<String?>(null)
    override val tokenFlow = state.asStateFlow()
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val loaded = scope.async {
        if (file.exists()) {
            try {
                val bytes = file.readBytes()
                val cipher = Cipher.getInstance("AES/GCM/NoPadding")
                cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, bytes.copyOfRange(0, 12)))
                state.value = cipher.doFinal(bytes.copyOfRange(12, bytes.size)).toString(Charsets.UTF_8)
            } catch (_: java.security.GeneralSecurityException) {
                file.delete()
            } catch (_: java.io.IOException) {
                file.delete()
            } catch (_: IndexOutOfBoundsException) {
                file.delete()
            }
        }
    }

    private fun key(): SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (store.getKey("saul.session", null) as? SecretKey)?.let { return it }
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").apply {
            init(KeyGenParameterSpec.Builder("saul.session", KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).setKeySize(256).build())
        }.generateKey()
    }

    override suspend fun save(value: String) = withContext(Dispatchers.IO) {
        loaded.await()
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, key())
        val pending = File(file.parentFile, "credential.tmp")
        pending.writeBytes(cipher.iv + cipher.doFinal(value.toByteArray(Charsets.UTF_8)))
        check(pending.renameTo(file)) { "Could not persist credential" }
        state.value = value
    }

    override suspend fun clear() = withContext(Dispatchers.IO) {
        loaded.await()
        file.delete()
        File(file.parentFile, "credential.tmp").delete()
        state.value = null
    }
}
