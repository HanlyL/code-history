package com.svnannotator

import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.components.ApplicationComponent
import com.intellij.notification.Notification
import com.intellij.notification.NotificationType
import com.intellij.notification.Notifications

class StatusBarManager : ApplicationComponent {
    private var isEnabled = false

    companion object {
        private var instance: StatusBarManager? = null

        fun getInstance(): StatusBarManager {
            if (instance == null) {
                instance = StatusBarManager()
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

    override fun getComponentName(): String = "StatusBarManager"

    fun updateStatus(enabled: Boolean) {
        isEnabled = enabled
        if (enabled && SvnService.getInstance().isLoggedIn()) {
            showNotification("SVN Annotator Enabled", "Annotations are now active", NotificationType.INFORMATION)
        }
    }

    fun showNotification(title: String, message: String, type: NotificationType) {
        ApplicationManager.getApplication().invokeLater {
            val notification = Notification("SVN Annotator", title, message, type)
            Notifications.Bus.notify(notification)
        }
    }
}