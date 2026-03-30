package com.svnannotator

import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.components.ApplicationComponent
import com.intellij.openapi.components.PersistentStateComponent
import com.intellij.openapi.components.State
import com.intellij.openapi.components.Storage
import com.intellij.openapi.project.Project
import com.intellij.openapi.project.ProjectManager
import org.jdom.Element
import java.io.BufferedReader
import java.io.File
import java.io.InputStreamReader
import java.util.concurrent.ConcurrentHashMap

@State(name = "SvnServiceCredentials", storages = [Storage("svn-annotator-settings.xml")])
class SvnService : ApplicationComponent, PersistentStateComponent<Element> {
    private var username: String = ""
    private var password: String = ""
    private var svnPath: String = "svn"
    private val cache = ConcurrentHashMap<String, CacheEntry>()
    private val pendingRequests = ConcurrentHashMap.newKeySet<String>()
    private val logMessageCache = ConcurrentHashMap<String, String>()

    companion object {
        private var instance: SvnService? = null
        private const val DEFAULT_CACHE_TTL_MS = 5 * 60 * 1000L

        fun getInstance(): SvnService {
            if (instance == null) {
                instance = SvnService()
            }
            return instance!!
        }
    }

    override fun initComponent() {
        instance = this
    }

    override fun disposeComponent() {
        instance = null
    }

    override fun getComponentName(): String = "SvnService"

    override fun getState(): Element {
        val element = Element("SvnServiceCredentials")
        element.setAttribute("username", username)
        element.setAttribute("password", password)
        element.setAttribute("svnPath", svnPath)
        return element
    }

    override fun loadState(element: Element) {
        username = element.getAttributeValue("username", "")
        password = element.getAttributeValue("password", "")
        svnPath = element.getAttributeValue("svnPath", "svn")
    }

    fun isLoggedIn(): Boolean = username.isNotEmpty()
    fun getUsername(): String = username
    fun getPassword(): String = password
    fun getSvnPath(): String = svnPath

    fun login(user: String, pass: String, callback: (LoginResult) -> Unit) {
        username = user
        password = pass
        callback(LoginResult(true))
    }

    fun logout() {
        username = ""
        password = ""
    }

    fun getBlame(filePath: String, project: Project, callback: (List<SvnAnnotation>?) -> Unit) {
        val cacheKey = getCacheKey(filePath)
        val cached = getFromCache(filePath)
        if (cached != null) {
            callback(cached)
            return
        }

        if (!pendingRequests.add(cacheKey)) {
            callback(null)
            return
        }

        ApplicationManager.getApplication().executeOnPooledThread {
            try {
                val annotations = fetchBlame(filePath)
                if (annotations != null && annotations.isNotEmpty()) {
                    cache[cacheKey] = CacheEntry(annotations, System.currentTimeMillis(), getFileModifiedTime(filePath))
                }
                pendingRequests.remove(cacheKey)
                callback(annotations)
            } catch (e: Exception) {
                pendingRequests.remove(cacheKey)
                callback(null)
            }
        }
    }

    fun getAnnotationForLine(filePath: String, lineNumber: Int, callback: ((SvnAnnotation?) -> Unit)? = null) {
        val cacheKey = getCacheKey(filePath)
        val entry = cache[cacheKey]

        if (entry != null) {
            val annotation = entry.annotations.getOrNull(lineNumber)
            if (annotation != null && annotation.message.isEmpty() && annotation.revision.isNotEmpty()) {
                val message = getCommitMessage(filePath, annotation.revision)
                if (!message.isNullOrEmpty()) {
                    val updatedAnnotation = annotation.copy(message = message)
                    val index = entry.annotations.indexOf(annotation)
                    if (index >= 0) {
                        val updatedList = entry.annotations.toMutableList()
                        updatedList[index] = updatedAnnotation
                        cache[cacheKey] = entry.copy(annotations = updatedList)
                    }
                    callback?.invoke(updatedAnnotation)
                    return
                }
            }
            callback?.invoke(annotation)
            return
        }

        getBlame(filePath, ProjectManager.getInstance().defaultProject) { annotations ->
            if (annotations != null && annotations.isNotEmpty()) {
                val annotation = annotations.getOrNull(lineNumber)
                callback?.invoke(annotation)
            } else {
                callback?.invoke(null)
            }
        }
    }

    fun getCommitMessage(filePath: String, revision: String): String? {
        if (revision.isEmpty()) return null
        val cacheKey = "$filePath:$revision"
        if (logMessageCache.containsKey(cacheKey)) {
            return logMessageCache[cacheKey]
        }

        return try {
            val args = mutableListOf<String>()
            args.add(svnPath)
            args.add("log")
            args.add("-r")
            args.add(revision)
            args.add(filePath)
            args.add("--xml")
            if (username.isNotEmpty()) {
                args.add("--non-interactive")
                args.add("--username")
                args.add(username)
                if (password.isNotEmpty()) {
                    args.add("--password")
                    args.add(password)
                }
            }

            val process = Runtime.getRuntime().exec(args.toTypedArray())
            val bytes = process.inputStream.readBytes()
            val exitCode = process.waitFor()
            val output = EncodingUtils.decodeSvnOutput(bytes)

            if (exitCode == 0) {
                val message = parseLogMessage(output)
                if (message != null) {
                    logMessageCache[cacheKey] = message
                }
                message
            } else {
                null
            }
        } catch (e: Exception) {
            null
        }
    }

    fun clearCache() {
        cache.clear()
        logMessageCache.clear()
    }

    fun clearCacheForFile(filePath: String) {
        val cacheKey = getCacheKey(filePath)
        cache.remove(cacheKey)
        logMessageCache.entries.removeIf { it.key.startsWith("$filePath:") }
    }

    private fun getCacheKey(filePath: String): String = "$filePath:${File(filePath).lastModified()}"

    private fun getFromCache(filePath: String): List<SvnAnnotation>? {
        val cacheKey = getCacheKey(filePath)
        val entry = cache[cacheKey] ?: return null
        if (System.currentTimeMillis() - entry.timestamp > DEFAULT_CACHE_TTL_MS) {
            cache.remove(cacheKey)
            return null
        }
        return entry.annotations
    }

    private fun getFileModifiedTime(filePath: String): Long {
        return try { File(filePath).lastModified() } catch (e: Exception) { 0L }
    }

    private fun fetchBlame(filePath: String): List<SvnAnnotation>? {
        return try {
            val args = buildList {
                add(svnPath)
                add("blame")
                add("--xml")
                add(filePath)
                if (username.isNotEmpty()) {
                    add("--non-interactive")
                    add("--username")
                    add(username)
                    if (password.isNotEmpty()) {
                        add("--password")
                        add(password)
                    }
                }
            }.toTypedArray()

            val process = Runtime.getRuntime().exec(args)
            val bytes = process.inputStream.readBytes()
            val exitCode = process.waitFor()
            val stdout = EncodingUtils.decodeSvnOutput(bytes)

            if (exitCode != 0) return null
            parseBlameXml(stdout)
        } catch (e: Exception) {
            null
        }
    }

    private fun parseBlameXml(xmlOutput: String): List<SvnAnnotation> {
        val annotations = mutableListOf<SvnAnnotation>()

        val entryBlockRegex = Regex("<entry\\b[^>]*line-number=\"(\\d+)\"[^>]*>([\\s\\S]*?)</entry>")
        entryBlockRegex.findAll(xmlOutput).forEach { match ->
            val lineNumStr = match.groupValues[1]
            val entryBody = match.groupValues[2]

            val commitMatch = Regex("<commit\\b[^>]*revision=\"([^\"]+)\"[^>]*>([\\s\\S]*?)</commit>").find(entryBody)
            if (commitMatch != null) {
                val revision = commitMatch.groupValues[1]
                val commitBody = commitMatch.groupValues[2]
                val author = Regex("<author>([\\s\\S]*?)</author>").find(commitBody)?.groupValues?.get(1)?.trim() ?: "Unknown"
                val date = Regex("<date>([\\s\\S]*?)</date>").find(commitBody)?.groupValues?.get(1)?.trim() ?: ""

                val lineNumber = lineNumStr.toIntOrNull() ?: (annotations.size + 1)

                annotations.add(SvnAnnotation(
                    lineNumber = lineNumber,
                    author = author,
                    date = date,
                    message = "",
                    revision = revision
                ))
            }
        }

        return annotations.sortedBy { it.lineNumber }
    }

    private fun parseLogMessage(xmlOutput: String): String? {
        val msgMatch = Regex("<msg>([\\s\\S]*?)</msg>").find(xmlOutput)
        return msgMatch?.groupValues?.get(1)?.trim()
    }

    private fun readStream(reader: BufferedReader): String {
        val sb = StringBuilder()
        var line: String?
        while (reader.readLine().also { line = it } != null) {
            sb.append(line)
            sb.append("\n")
        }
        return sb.toString()
    }

    private fun readStream(inputStream: java.io.InputStream): String {
        return readStream(BufferedReader(InputStreamReader(inputStream)))
    }
}
