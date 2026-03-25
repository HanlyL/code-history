package com.svnannotator

import com.intellij.openapi.ui.DialogWrapper
import com.intellij.openapi.ui.Messages
import java.awt.Cursor
import javax.swing.JLabel
import javax.swing.JPanel
import javax.swing.JPasswordField
import javax.swing.JTextField
import javax.swing.GroupLayout

class LoginDialog : DialogWrapper(true) {
    private val usernameField = JTextField(20)
    private val passwordField = JPasswordField(20)

    init {
        title = "SVN Login"
        init()
    }

    override fun createCenterPanel(): JPanel {
        val panel = JPanel()

        val layout = GroupLayout(panel)
        panel.layout = layout
        layout.autoCreateGaps = true
        layout.autoCreateContainerGaps = true

        val usernameLabel = JLabel("Username:")
        val passwordLabel = JLabel("Password:")

        layout.setHorizontalGroup(
            layout.createParallelGroup(GroupLayout.Alignment.LEADING)
                .addGroup(
                    layout.createSequentialGroup()
                        .addComponent(usernameLabel)
                        .addPreferredGap(javax.swing.LayoutStyle.ComponentPlacement.RELATED)
                        .addComponent(usernameField)
                )
                .addGroup(
                    layout.createSequentialGroup()
                        .addComponent(passwordLabel)
                        .addPreferredGap(javax.swing.LayoutStyle.ComponentPlacement.RELATED)
                        .addComponent(passwordField)
                )
        )

        layout.setVerticalGroup(
            layout.createSequentialGroup()
                .addGroup(
                    layout.createParallelGroup(GroupLayout.Alignment.BASELINE)
                        .addComponent(usernameLabel)
                        .addComponent(usernameField)
                )
                .addGroup(
                    layout.createParallelGroup(GroupLayout.Alignment.BASELINE)
                        .addComponent(passwordLabel)
                        .addComponent(passwordField)
                )
        )

        return panel
    }

    override fun doOKAction() {
        val username = usernameField.text.trim()
        val password = String(passwordField.password)

        if (username.isEmpty() || password.isEmpty()) {
            Messages.showErrorDialog("Username and password cannot be empty", "Login Error")
            return
        }

        com.intellij.openapi.diagnostic.Logger.getInstance(javaClass).info("Login attempt for user: $username")

        SvnService.getInstance().login(username, password) { result ->
            com.intellij.openapi.diagnostic.Logger.getInstance(javaClass).info("Login result: success=${result.success}, error=${result.error}")
            if (result.success) {
                StatusBarManager.getInstance().updateStatus(true)
                StatusBarManager.getInstance().showNotification("SVN Annotator", "Login successful!", com.intellij.notification.NotificationType.INFORMATION)
                Annotator.getInstance().enable()
            } else {
                Messages.showErrorDialog("Login failed: ${result.error ?: "Unknown error"}", "Login Error")
            }
        }

        close(OK_EXIT_CODE)
    }

    override fun doCancelAction() {
        super.doCancelAction()
    }
}

class LoginAction : com.intellij.openapi.actionSystem.AnAction() {
    override fun actionPerformed(e: com.intellij.openapi.actionSystem.AnActionEvent) {
        val dialog = LoginDialog()
        dialog.show()
    }
}

class RefreshAction : com.intellij.openapi.actionSystem.AnAction() {
    override fun actionPerformed(e: com.intellij.openapi.actionSystem.AnActionEvent) {
        val project = e.project ?: return
        val editor = com.intellij.openapi.fileEditor.FileEditorManager.getInstance(project).selectedTextEditor ?: return
        Annotator.getInstance().refresh(editor)
    }
}

class ToggleAction : com.intellij.openapi.actionSystem.AnAction() {
    override fun actionPerformed(e: com.intellij.openapi.actionSystem.AnActionEvent) {
        Annotator.getInstance().toggle()
    }
}