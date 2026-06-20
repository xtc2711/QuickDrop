package com.quickdrop.app

import android.app.Application
import android.webkit.WebView
import com.quickdrop.app.auth.TokenManager
import com.quickdrop.app.webview.JSBridge

/**
 * QuickDrop Android Application
 *
 * 初始化全局依赖：TokenManager、WebView 调试配置
 * 持有 JSBridge 引用供 QRScannerActivity 等组件回调
 */
class QuickDropApplication : Application() {

    lateinit var tokenManager: TokenManager
        private set

    /** JSBridge 引用 — 由 MainActivity 在初始化时设置 */
    var jsBridge: JSBridge? = null

    override fun onCreate() {
        super.onCreate()
        instance = this

        // 初始化 TokenManager（加密 SharedPreferences）
        tokenManager = TokenManager(this)

        // 开发环境启用 WebView 调试
        if (com.quickdrop.app.BuildConfig.DEBUG) {
            WebView.setWebContentsDebuggingEnabled(true)
        }
    }

    companion object {
        lateinit var instance: QuickDropApplication
            private set
    }
}
