package io.github.gajendrasinghdawar.lali.data.chat

import android.content.ContentResolver
import android.net.Uri
import android.provider.OpenableColumns
import io.github.gajendrasinghdawar.lali.core.network.GatewayApi
import io.ktor.client.call.body
import io.ktor.client.request.*
import io.ktor.client.statement.bodyAsText
import io.ktor.http.*
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.*
import java.io.ByteArrayOutputStream
import java.io.InputStream
import java.net.URLEncoder

const val MAX_FILE_BYTES = 5 * 1024 * 1024
val SUPPORTED_MIME_TYPES = setOf("image/png", "image/jpeg", "image/webp", "text/plain", "text/markdown", "text/csv", "application/json")
@Serializable data class Attachment(val id: String, val name: String, val mimeType: String, val size: Long)
data class ArtifactCapabilities(val enabled: Boolean = false, val supportedMimeTypes: Set<String> = emptySet(), val maxFileBytes: Int = MAX_FILE_BYTES, val maxFilesPerMessage: Int = 4, val supportsImages: Boolean = false, val maxTextFileBytes: Int = 64 * 1024) {
    val pickerTypes: Set<String> get() = supportedMimeTypes.intersect(SUPPORTED_MIME_TYPES).filter { supportsImages || !it.startsWith("image/") }.toSet()
}
interface ArtifactRepository {
    suspend fun capabilities(): ArtifactCapabilities
    suspend fun upload(uri: String, capabilities: ArtifactCapabilities): Attachment
    suspend fun download(file: Attachment, destination: String)
}

/** Reads only picker-granted content URIs. No filesystem paths or durable URI permissions. */
class GatewayArtifactRepository(private val api: GatewayApi, private val resolver: ContentResolver) : ArtifactRepository {
    override suspend fun capabilities(): ArtifactCapabilities {
        val body = api.request(HttpMethod.Get, "/api/artifacts/capabilities")
        return ArtifactCapabilities(body.getValue("enabled").jsonPrimitive.boolean,
            body.getValue("supportedMimeTypes").jsonArray.map { it.jsonPrimitive.content }.toSet(),
            body.getValue("maxFileBytes").jsonPrimitive.int.coerceIn(1, MAX_FILE_BYTES),
            body.getValue("maxFilesPerMessage").jsonPrimitive.int.coerceIn(1, 4),
            body.getValue("supportsImages").jsonPrimitive.boolean,
            (body["maxTextFileBytes"]?.jsonPrimitive?.int ?: 64 * 1024).coerceIn(1, 64 * 1024))
    }
    override suspend fun upload(uri: String, capabilities: ArtifactCapabilities): Attachment = withContext(Dispatchers.IO) {
        require(capabilities.enabled) { "Attachments are unavailable on this server." }
        val source = Uri.parse(uri)
        require(source.scheme == "content") { "Choose a file using the document picker." }
        var name = "attachment"
        var size: Long? = null
        resolver.query(source, arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE), null, null, null)?.use { cursor ->
            if (cursor.moveToFirst()) {
                val nameIndex = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                if (nameIndex >= 0) name = cursor.getString(nameIndex) ?: name
                val sizeIndex = cursor.getColumnIndex(OpenableColumns.SIZE)
                if (sizeIndex >= 0 && !cursor.isNull(sizeIndex)) size = cursor.getLong(sizeIndex)
            }
        }
        val mime = fileMimeType(name, resolver.getType(source))
        require(mime in capabilities.pickerTypes) { "Unsupported file type. PDF, audio and video are not supported; images require model image support." }
        val limit = if (mime.startsWith("image/")) capabilities.maxFileBytes else minOf(capabilities.maxFileBytes, capabilities.maxTextFileBytes)
        require(size == null || size <= limit) { "Images must be at most 5 MiB; text files at most 64 KiB." }
        val bytes = resolver.openInputStream(source)?.use { readBoundedFile(it, limit) } ?: error("Could not open the selected file.")
        uploadArtifact(api, name, mime, bytes, capabilities)
    }
    override suspend fun download(file: Attachment, destination: String): Unit = withContext(Dispatchers.IO) {
        val response = api.http.get("${api.baseUrl.trimEnd('/')}/api/artifacts/${file.id.encodeURLPathPart()}") { api.authorize(this) }
        api.check(response)
        require(response.headers[HttpHeaders.ContentLength]?.toLongOrNull()?.let { it in 1..MAX_FILE_BYTES } == true) { "Invalid download size." }
        val bytes = response.body<ByteArray>()
        require(bytes.isNotEmpty() && bytes.size <= MAX_FILE_BYTES) { "Invalid download size." }
        resolver.openOutputStream(Uri.parse(destination), "w")?.use { it.write(bytes) } ?: error("Could not save the file.")
    }
}

internal fun fileMimeType(name: String, reported: String?): String = when (name.substringAfterLast('.', "").lowercase()) {
    "png" -> "image/png"
    "jpg", "jpeg" -> "image/jpeg"
    "webp" -> "image/webp"
    "txt" -> "text/plain"
    "md", "markdown" -> "text/markdown"
    "csv" -> "text/csv"
    "json" -> "application/json"
    else -> reported ?: "application/octet-stream"
}

internal suspend fun uploadArtifact(api: GatewayApi, name: String, mime: String, bytes: ByteArray, capabilities: ArtifactCapabilities): Attachment {
        require(capabilities.enabled && mime in capabilities.pickerTypes) { "Unsupported file type or attachments disabled." }
        val limit = if (mime.startsWith("image/")) capabilities.maxFileBytes.coerceAtMost(MAX_FILE_BYTES) else minOf(capabilities.maxFileBytes, capabilities.maxTextFileBytes, 64 * 1024)
        require(bytes.isNotEmpty() && bytes.size <= limit) { "Use a nonempty image up to 5 MiB or text file up to 64 KiB." }
        val response = api.http.post("${api.baseUrl.trimEnd('/')}/api/artifacts") {
            api.authorize(this)
            contentType(ContentType.Application.OctetStream)
            header("x-file-name", URLEncoder.encode(name, "UTF-8").replace("+", "%20"))
            header("x-file-type", mime)
            setBody(bytes)
        }
        api.check(response)
        return Json.decodeFromString<Attachment>(response.bodyAsText())
}

internal fun readBoundedFile(input: InputStream, limit: Int): ByteArray {
    val bound = limit.coerceIn(1, MAX_FILE_BYTES)
    val output = ByteArrayOutputStream()
    val buffer = ByteArray(8192)
    while (true) {
        val read = input.read(buffer, 0, minOf(buffer.size, bound - output.size() + 1))
        if (read < 0) return output.toByteArray()
        require(output.size() + read <= bound) { "Selected file exceeds the upload size limit." }
        output.write(buffer, 0, read)
    }
}
