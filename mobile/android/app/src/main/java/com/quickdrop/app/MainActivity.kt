package com.quickdrop.app

import android.os.Bundle
import android.webkit.WebView
import android.widget.ProgressBar
import androidx.activity.ComponentActivity
import com.quickdrop.app.webview.JSBridge
import com.quickdrop.app.webview.WebViewConfig

/**
 * QuickDrop 主 Activity
 *
 * 以 WebView 承载全部 UI 逻辑：
 * - 登录/注册 → 设备列表 → 文件传输
 * - 所有页面由 Web 前端渲染（与桌面端共享 UI 代码）
 * - 通过 JSBridge 调用原生能力（扫码、文件选择、Token 存储）
 */
class MainActivity : ComponentActivity() {

    private lateinit var webView: WebView
    private lateinit var loadingProgress: ProgressBar
    private lateinit var jsBridge: JSBridge

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        webView = findViewById(R.id.webview)
        loadingProgress = findViewById(R.id.loading_progress)

        // 初始化 JS Bridge 并注册到 Application（供其他组件回调）
        jsBridge = JSBridge(webView)
        (application as QuickDropApplication).jsBridge = jsBridge

        // 配置 WebView（WebRTC、JS、DOM Storage）
        WebViewConfig.configure(webView, jsBridge)

        // 加载前端页面
        // 开发环境：加载本地开发服务器
        // 生产环境：加载打包后的 assets
        val url = if (com.quickdrop.app.BuildConfig.DEBUG) {
            "http://10.0.2.2:5173" // Vite 开发服务器
        } else {
            "file:///android_asset/web/index.html"
        }
        webView.loadUrl(url)
    }

    override fun onBackPressed() {
        if (webView.canGoBack()) {
            webView.goBack()
        } else {
            super.onBackPressed()
        }
    }
}
