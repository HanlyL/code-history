package com.svnannotator

import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.application.ApplicationManager
import com.intellij.diff.DiffContentFactory
import com.intellij.diff.DiffManager
import com.intellij.diff.requests.SimpleDiffRequest
import com.intellij.openapi.fileEditor.FileDocumentManager
import com.intellij.openapi.project.Project
import com.intellij.openapi.project.ProjectManager
import com.intellij.openapi.ui.Messages
import java.io.File

class ViewChangesAction : AnAction() {
    override fun actionPerformed(e: AnActionEvent) {
        val project = e.project ?: ProjectManager.getInstance().defaultProject
        val editor = com.intellij.openapi.fileEditor.FileEditorManager.getInstance(project).selectedTextEditor
        if (editor == null) {
            Messages.showWarningDialog("No editor open", "SVN Annotator")
            return
        }

        val filePath = FileDocumentManager.getInstance().getFile(editor.document)?.path
        if (filePath == null) {
            Messages.showWarningDialog("Cannot determine file path", "SVN Annotator")
            return
        }

        val caret = editor.caretModel.primaryCaret
        val lineNumber = caret.logicalPosition.line

        ApplicationManager.getApplication().executeOnPooledThread {
            try {
                SvnService.getInstance().getAnnotationForLine(filePath, lineNumber) { annotation ->
                    if (annotation == null || annotation.revision.isEmpty()) {
                        ApplicationManager.getApplication().invokeLater {
                            Messages.showWarningDialog("No revision info for this line", "SVN Annotator")
                        }
                        return@getAnnotationForLine
                    }

                    val revision = annotation.revision
                    val (leftRev, rightRev) = getRevisionPair(revision)

                    val file = File(filePath)
                    val workingDir = file.parentFile
                    val svnService = SvnService.getInstance()

                    val leftResult = runSvnCat(svnService, filePath, leftRev, workingDir, true)
                    val rightResult = runSvnCat(svnService, filePath, rightRev, workingDir, false)

                    ApplicationManager.getApplication().invokeLater {
                        if (!rightResult.success) {
                            val msg = if (rightResult.output.isNotBlank()) rightResult.output else "读取右侧版本失败（$rightRev）"
                            Messages.showWarningDialog(msg, "SVN Annotator")
                            return@invokeLater
                        }
                        if (!leftResult.success && !leftResult.allowedFailure) {
                            val msg = if (leftResult.output.isNotBlank()) leftResult.output else "读取左侧版本失败（$leftRev）"
                            Messages.showWarningDialog(msg, "SVN Annotator")
                            return@invokeLater
                        }

                        val leftText = leftResult.output
                        val rightText = rightResult.output
                        if (leftText == rightText) {
                            Messages.showInfoMessage("该修订区间无可展示的差异（r$leftRev → r$rightRev）", "SVN Diff")
                        } else {
                            showDiff(project, filePath, leftRev, rightRev, leftText, rightText)
                        }
                    }
                }
            } catch (ex: Exception) {
                ApplicationManager.getApplication().invokeLater {
                    val errorMessage = ex.message?.let { EncodingUtils.decodeSvnOutput(it.toByteArray()) } ?: "Unknown error"
                    Messages.showErrorDialog("Failed to view changes: $errorMessage", "SVN Annotator")
                }
            }
        }
    }

    private fun showDiff(
        project: Project,
        filePath: String,
        leftRev: String,
        rightRev: String,
        leftText: String,
        rightText: String
    ) {
        val contentFactory = DiffContentFactory.getInstance()
        val request = SimpleDiffRequest(
            "SVN Diff r$leftRev ↔ r$rightRev",
            contentFactory.create(project, leftText),
            contentFactory.create(project, rightText),
            "r$leftRev",
            "r$rightRev"
        )
        DiffManager.getInstance().showDiff(project, request)
    }

    private fun runSvnCat(
        svnService: SvnService,
        filePath: String,
        revision: String,
        workingDir: File?,
        allowMissing: Boolean
    ): SvnCommandResult {
        val args = buildList {
            add(svnService.getSvnPath())
            add("cat")
            add("-r")
            add(revision)
            add(withPegRevision(filePath, "HEAD"))
            if (svnService.isLoggedIn()) {
                add("--non-interactive")
                add("--username")
                add(svnService.getUsername())
                if (svnService.getPassword().isNotEmpty()) {
                    add("--password")
                    add(svnService.getPassword())
                }
            }
        }

        val processBuilder = ProcessBuilder(args)
        processBuilder.directory(workingDir)
        processBuilder.redirectErrorStream(false)
        val process = processBuilder.start()

        val stdoutBytes = process.inputStream.readBytes()
        val stderrBytes = process.errorStream.readBytes()
        val exitCode = process.waitFor()
        val stdout = EncodingUtils.decodeSvnOutput(stdoutBytes)
        val stderr = EncodingUtils.decodeSvnOutput(stderrBytes)

        if (exitCode == 0) {
            return SvnCommandResult(success = true, output = stdout, allowedFailure = false)
        }
        if (allowMissing && isMissingAtRevisionError(stderr)) {
            return SvnCommandResult(success = false, output = "", allowedFailure = true)
        }
        return SvnCommandResult(success = false, output = stderr.ifBlank { stdout }, allowedFailure = false)
    }

    private fun withPegRevision(filePath: String, pegRevision: String): String {
        if (filePath.contains("@")) return filePath
        return "$filePath@$pegRevision"
    }

    private fun isMissingAtRevisionError(errorText: String): Boolean {
        return Regex("E195012|E160013|E200009|Unable to find repository location", RegexOption.IGNORE_CASE).containsMatchIn(errorText)
    }

    private fun getRevisionPair(revision: String): Pair<String, String> {
        val right = revision.toIntOrNull()
        return if (right != null) {
            val left = maxOf(1, right - 1)
            left.toString() to right.toString()
        } else {
            "PREV" to revision
        }
    }

    private data class SvnCommandResult(
        val success: Boolean,
        val output: String,
        val allowedFailure: Boolean
    )
}
