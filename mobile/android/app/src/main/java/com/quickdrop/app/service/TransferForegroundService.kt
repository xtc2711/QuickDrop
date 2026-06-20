package com.quickdrop.app.service

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.os.IBinder
import androidx.core.app.NotificationCompat
import com.quickdrop.app.MainActivity
import com.quickdrop.app.R

/**
 * 文件传输前台服务
 *
 * 保持文件传输在后台持续运行：
 * - 防止系统杀死进程
 * - 通知栏显示传输进度
 * - 支持多个并行传输显示
 */
class TransferForegroundService : Service() {

    private var notificationManager: NotificationManager? = null
    private var isRunning = false

    override fun onCreate() {
        super.onCreate()
        notificationManager = getSystemService(NOTIFICATION_SERVICE) as NotificationManager
        createNotificationChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (isRunning) return START_STICKY

        val notification = buildNotification(
            title = getString(R.string.channel_transfer),
            content = getString(R.string.transfer_sending)
        )

        startForeground(NOTIFICATION_ID, notification)
        isRunning = true

        return START_STICKY
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        isRunning = false
        super.onDestroy()
    }

    /**
     * 更新通知栏传输进度
     * @param progress 0–100
     * @param fileName 当前文件
     * @param speed 传输速度
     */
    fun updateProgress(progress: Int, fileName: String, speed: String) {
        val notification = NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("${getString(R.string.transfer_sending)} ($progress%)")
            .setContentText("$fileName — $speed")
            .setSmallIcon(android.R.drawable.stat_sys_upload)
            .setOngoing(true)
            .setProgress(100, progress, false)
            .setContentIntent(createMainPendingIntent())
            .build()

        notificationManager?.notify(NOTIFICATION_ID, notification)
    }

    /**
     * 传输完成通知
     */
    fun showCompleteNotification(fileName: String) {
        val notification = NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle(getString(R.string.transfer_complete))
            .setContentText(fileName)
            .setSmallIcon(android.R.drawable.stat_sys_upload_done)
            .setAutoCancel(true)
            .setContentIntent(createMainPendingIntent())
            .build()

        notificationManager?.notify(NOTIFICATION_ID + 1, notification)
    }

    // ============================================================
    // Private
    // ============================================================

    private fun createNotificationChannel() {
        val channel = NotificationChannel(
            CHANNEL_ID,
            getString(R.string.channel_transfer),
            NotificationManager.IMPORTANCE_LOW // 低优先级，不打扰用户
        ).apply {
            description = getString(R.string.channel_transfer_desc)
        }
        notificationManager?.createNotificationChannel(channel)
    }

    private fun buildNotification(title: String, content: String): Notification {
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle(title)
            .setContentText(content)
            .setSmallIcon(android.R.drawable.stat_sys_upload)
            .setOngoing(true)
            .setContentIntent(createMainPendingIntent())
            .build()
    }

    private fun createMainPendingIntent(): PendingIntent {
        val intent = Intent(this, MainActivity::class.java)
        return PendingIntent.getActivity(
            this, 0, intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
    }

    companion object {
        private const val CHANNEL_ID = "quickdrop_transfer"
        private const val NOTIFICATION_ID = 1001
    }
}
