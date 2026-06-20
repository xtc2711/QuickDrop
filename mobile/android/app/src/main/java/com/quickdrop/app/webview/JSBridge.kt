package com.quickdrop.app.webview

import android.content.Intent
import android.webkit.JavascriptInterface
import android.webkit.WebView
import com.quickdrop.app.QuickDropApplication
import com.quickdrop.app.camera.QRScannerActivity

/**
 * JavaScript ↔ Android Native 桥接
 *
 * 暴露给 WebView 中 JS 调用的原生能力：
 * - 扫码
 * - Token 存取
 * - 文件选择（TODO）
 * - 前台服务控制（TODO）
 *
 * Web 端调用方式：window.QuickDropBridge.<method>()
 */
class JSBridge(private val webView: WebView) {

    private val tokenManager = QuickDropApplication.instance.tokenManager

    /**
     * 打开扫码页面
     * JS 调用: QuickDropBridge.startQRScanner()
     */
    @JavascriptInterface
    fun startQRScanner() {
        val intent = Intent(webView.context, QRScannerActivity::class.java)
        webView.context.startActivity(intent)
    }

    /**
     * 保存 Access Token
     * JS 调用: QuickDropBridge.saveToken(accessToken, refreshToken)
     */
    @JavascriptInterface
    fun saveToken(accessToken: String, refreshToken: String) {
        tokenManager.saveTokens(accessToken, refreshToken)
    }

    /**
     * 获取 Access Token（异步返回给 JS）
     * JS 调用: QuickDropBridge.getAccessToken()
     * 返回 token 字符串，无则返回空
     */
    @JavascriptInterface
    fun getAccessToken(): String {
        return tokenManager.getAccessToken() ?: ""
    }

    /**
     * 获取 Refresh Token
     */
    @JavascriptInterface
    fun getRefreshToken(): String {
        return tokenManager.getRefreshToken() ?: ""
    }

    /**
     * 清除所有 Token
     * JS 调用: QuickDropBridge.clearTokens()
     */
    @JavascriptInterface
    fun clearTokens() {
        tokenManager.clearTokens()
    }

    /**
     * 获取认证服务地址
     */
    @JavascriptInterface
    fun getAuthBaseUrl(): String {
        return com.quickdrop.app.BuildConfig.AUTH_BASE_URL
    }

    /**
     * 获取信令服务 WebSocket 地址
     */
    @JavascriptInterface
    fun getSignalWsUrl(): String {
        return com.quickdrop.app.BuildConfig.SIGNAL_WS_URL
    }

    /**
     * 选择文件（触发 Android 文件选择器）
     * JS 调用: QuickDropBridge.pickFiles()
     * 结果将通过回调通知 JS
     */
    @JavascriptInterface
    fun pickFiles() {
        // TODO: 实现系统文件选择器，通过 evaluateJavascript 回调文件路径
        webView.post {
            webView.evaluateJavascript(
                "if(typeof onNativeFilePicked === 'function') onNativeFilePicked([])",
                null
            )
        }
    }

    /**
     * 页面加载完成后注入已保存的 Token 到 JS
     */
    fun injectToken() {
        val accessToken = tokenManager.getAccessToken()
        val refreshToken = tokenManager.getRefreshToken()
        if (accessToken != null && refreshToken != null) {
            webView.evaluateJavascript(
                """
                if (typeof onNativeTokensReady === 'function') {
                    onNativeTokensReady('$accessToken', '$refreshToken');
                }
                """.trimIndent(),
                null
            )
        }
    }

    /**
     * 从 JS 接收扫码结果
     * 由 QRScannerActivity 在扫码成功后调用
     */
    fun onQRCodeScanned(qrData: String) {
        webView.post {
            val escaped = qrData.replace("'", "\\'").replace("\n", "\\n")
            webView.evaluateJavascript(
                "if(typeof onQRCodeScanned === 'function') onQRCodeScanned('$escaped')",
                null
            )
        }
    }
}
