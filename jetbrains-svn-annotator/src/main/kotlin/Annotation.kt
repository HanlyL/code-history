package com.svnannotator

import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.components.ApplicationComponent
import com.intellij.openapi.diagnostic.Logger
import com.intellij.openapi.editor.Editor
import com.intellij.openapi.editor.EditorFactory
import com.intellij.openapi.editor.Inlay
import com.intellij.openapi.editor.InlayProperties
import com.intellij.openapi.editor.event.EditorFactoryListener
import com.intellij.openapi.editor.event.CaretListener
import com.intellij.openapi.fileEditor.FileDocumentManager
import com.intellij.openapi.fileEditor.FileEditorManager
import com.intellij.openapi.project.ProjectManager
import java.awt.Color
import java.awt.Graphics2D
import java.awt.geom.Rectangle2D

class Annotator : ApplicationComponent, EditorFactoryListener, CaretListener {
    private val logger = Logger.getInstance(Annotator::class.java)
    private var currentInlay: Inlay<*>? = null
    private var isEnabled: Boolean = true
    private val maxAnnotationLength: Int = 80
    private val editorCaretListeners = mutableMapOf<Editor, CaretListener>()

    companion object {
        private var instance: Annotator? = null

        fun getInstance(): Annotator {
            if (instance == null) {
                instance = Annotator()
            }
            return instance!!
        }
    }

    override fun initComponent() {
        instance = this
        EditorFactory.getInstance().addEditorFactoryListener(this)
        logger.info("Annotator initialized")
    }

    override fun disposeComponent() {
        instance = null
        currentInlay?.dispose()
        for ((editor, _) in editorCaretListeners) {
            editor.caretModel.removeCaretListener(this)
        }
        editorCaretListeners.clear()
        EditorFactory.getInstance().removeEditorFactoryListener(this)
    }

    override fun getComponentName(): String = "SvnAnnotator"

    override fun editorCreated(event: com.intellij.openapi.editor.event.EditorFactoryEvent) {
        val editor = event.editor
        if (!editorCaretListeners.containsKey(editor)) {
            editor.caretModel.addCaretListener(this)
            editorCaretListeners[editor] = this
            logger.info("CaretListener added to editor")
        }
    }

    override fun editorReleased(event: com.intellij.openapi.editor.event.EditorFactoryEvent) {
        val editor = event.editor
        editor.caretModel.removeCaretListener(this)
        editorCaretListeners.remove(editor)
        logger.info("CaretListener removed from editor")
    }

    fun isEnabled(): Boolean = isEnabled

    fun enable() {
        isEnabled = true
        updateCurrentLine()
        StatusBarManager.getInstance().updateStatus(true)
    }

    fun disable() {
        isEnabled = false
        currentInlay?.dispose()
        currentInlay = null
        StatusBarManager.getInstance().updateStatus(false)
    }

    fun toggle() {
        if (isEnabled) disable() else enable()
    }

    private fun updateCurrentLine() {
        if (!isEnabled) return
        val project = ProjectManager.getInstance().defaultProject
        val editor = FileEditorManager.getInstance(project).selectedTextEditor ?: return
        val filePath = FileDocumentManager.getInstance().getFile(editor.document)?.path ?: return

        if (!SvnService.getInstance().isLoggedIn()) return

        val lineNumber = editor.caretModel.logicalPosition.line
        showAnnotationForLine(editor, filePath, lineNumber)
    }

    private fun showAnnotationForLine(editor: Editor, filePath: String, lineNumber: Int) {
        logger.info("showAnnotationForLine: $filePath line $lineNumber")
        currentInlay?.dispose()
        currentInlay = null

        if (!SvnService.getInstance().isLoggedIn()) {
            logger.info("Not logged in")
            return
        }

        SvnService.getInstance().getBlame(filePath, ProjectManager.getInstance().defaultProject) { annotations ->
            if (annotations == null || annotations.isEmpty()) {
                logger.info("No annotations returned")
                return@getBlame
            }

            ApplicationManager.getApplication().invokeLater {
                if (!isEnabled) return@invokeLater

                val annotation = annotations.getOrNull(lineNumber) ?: run {
                    logger.info("No annotation for line $lineNumber")
                    return@invokeLater
                }
                if (annotation.author == "Unknown" || annotation.author.isEmpty() || annotation.revision.isEmpty()) {
                    logger.info("Invalid annotation: author=${annotation.author}, revision=${annotation.revision}")
                    return@invokeLater
                }

                val document = editor.document
                if (lineNumber >= document.lineCount) return@invokeLater

                val lineEndOffset = document.getLineEndOffset(lineNumber)
                val text = formatAnnotationText(annotation, filePath)

                logger.info("Creating inlay with text: $text")
                val renderer = InlineAnnotationRenderer(text)
                currentInlay = editor.inlayModel.addAfterLineEndElement(lineEndOffset, InlayProperties(), renderer)

                if (currentInlay != null) {
                    currentInlay?.putUserData(com.intellij.openapi.util.Key.create("svn.revision"), annotation.revision)
                    currentInlay?.putUserData(com.intellij.openapi.util.Key.create("svn.filepath"), filePath)
                    currentInlay?.putUserData(com.intellij.openapi.util.Key.create("svn.line"), lineNumber)
                    logger.info("Inlay created successfully")
                }
            }
        }
    }

    private fun formatAnnotationText(annotation: SvnAnnotation, filePath: String): String {
        val commitMessage = SvnService.getInstance().getCommitMessage(filePath, annotation.revision)
        val dateStr = formatDate(annotation.date)

        val parts = mutableListOf<String>()
        if (!commitMessage.isNullOrEmpty()) {
            parts.add(commitMessage.replace("\n", " ").trim())
        }
        parts.add(annotation.author)
        parts.add(dateStr)

        var text = parts.joinToString(" | ")
        if (text.length > maxAnnotationLength) {
            text = text.substring(0, maxAnnotationLength - 3) + "..."
        }
        return text
    }

    private fun formatDate(dateStr: String): String {
        if (dateStr.isEmpty()) return "Unknown"
        return try {
            val parts = dateStr.split("T")
            if (parts.size >= 2) {
                "${parts[0]}"
            } else {
                dateStr
            }
        } catch (e: Exception) {
            dateStr
        }
    }

    override fun caretPositionChanged(e: com.intellij.openapi.editor.event.CaretEvent) {
        logger.info("Caret position changed to line ${e.caret.logicalPosition.line}")
        if (isEnabled) {
            ApplicationManager.getApplication().invokeLater {
                val editor = e.editor
                val filePath = FileDocumentManager.getInstance().getFile(editor.document)?.path ?: return@invokeLater
                val lineNumber = editor.caretModel.logicalPosition.line
                showAnnotationForLine(editor, filePath, lineNumber)
            }
        }
    }

    override fun caretAdded(e: com.intellij.openapi.editor.event.CaretEvent) {}
    override fun caretRemoved(e: com.intellij.openapi.editor.event.CaretEvent) {}

    fun refresh(editor: Editor?) {
        if (editor == null) return
        val filePath = FileDocumentManager.getInstance().getFile(editor.document)?.path ?: return
        val lineNumber = editor.caretModel.logicalPosition.line
        SvnService.getInstance().clearCacheForFile(filePath)
        showAnnotationForLine(editor, filePath, lineNumber)
    }
}

class InlineAnnotationRenderer(private val text: String) : com.intellij.openapi.editor.EditorCustomElementRenderer {
    override fun calcWidthInPixels(inlay: com.intellij.openapi.editor.Inlay<*>): Int {
        return inlay.editor.component.getFontMetrics(inlay.editor.component.font).stringWidth(text) + 8
    }

    override fun paint(inlay: com.intellij.openapi.editor.Inlay<*>, g: Graphics2D, bounds: Rectangle2D, textAttributes: com.intellij.openapi.editor.markup.TextAttributes) {
        g.color = Color(180, 180, 180)
        g.font = inlay.editor.component.font
        val fm = inlay.editor.component.getFontMetrics(inlay.editor.component.font)
        g.drawString(text, bounds.x.toInt() + 4, bounds.y.toInt() + fm.ascent + 1)
    }

    override fun getContextMenuGroupId(inlay: com.intellij.openapi.editor.Inlay<*>): String? = null
    override fun getContextMenuGroup(inlay: com.intellij.openapi.editor.Inlay<*>): com.intellij.openapi.actionSystem.ActionGroup? = null
}