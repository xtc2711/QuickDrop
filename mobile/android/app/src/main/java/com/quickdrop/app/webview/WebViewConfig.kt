package com.quickdrop.app.webview

import android.annotation.SuppressLint
import android.webkit.WebChromeClient
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient

/**
 * WebView 配置工具
 *
 * 为 QuickDrop 配置 WebView：
 * - 启用 WebRTC（getUserMedia, RTCPeerConnection）
 * - 启用 JavaScript 和 DOM Storage
 * - 启用文件访问（文件选择器）
 * - 配置硬件加速
 */
object WebViewConfig {

    @SuppressLint("SetJavaScriptEnabled")
    fun configure(webView: WebView, jsBridge: JSBridge) {
        val settings: WebSettings = webView.settings

        // === JavaScript ===
        settings.javaScriptEnabled = true
        settings.domStorageEnabled = true

        // === WebRTC 支持 ===
        // Android WebView 原生支持 WebRTC（Chrome 37+）
        settings.mediaPlaybackRequiresUserGesture = false

        // === 文件访问 ===
        settings.allowFileAccess = true
        settings.allowContentAccess = true

        // === 视口 ===
        settings.useWideViewPort = true
        settings.loadWithOverviewMode = true
        settings.setSupportZoom(false)
        settings.builtInZoomControls = false

        // === 缓存 ===
        settings.cacheMode = WebSettings.LOAD_DEFAULT

        // === 安全性 ===
        settings.allowFileAccessFromFileURLs = false
        settings.allowUniversalAccessFromFileURLs = false
        settings.mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW

        // === 注册 JavaScript 桥接 ===
        webView.addJavascriptInterface(jsBridge, "QuickDropBridge")

        // === WebViewClient：处理页面加载和导航 ===
        webView.webViewClient = object : WebViewClient() {
            override fun onPageFinished(view: WebView?, url: String?) {
                super.onPageFinished(view, url)
                // 页面加载完成后注入 Token（如已登录）
                jsBridge.injectToken()
            }
        }

        // === WebChromeClient：处理 JS 对话框、文件选择、权限 ===
        webView.webChromeClient = object : WebChromeClient() {
            // 可在此处理 onPermissionRequest（摄像头/麦克风）
            override fun onPermissionRequest(request: android.webkit.PermissionRequest?) {
                request?.grant(request.resources)
            }
        }
    }
}
