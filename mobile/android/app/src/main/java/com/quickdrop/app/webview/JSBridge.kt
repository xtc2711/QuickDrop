package com.quickdrop.app.webview

import android.content.Intent
import android.net.Uri
import android.webkit.JavascriptInterface
import android.webkit.WebView
import com.quickdrop.app.QuickDropApplication
import com.quickdrop.app.camera.QRScannerActivity
import org.json.JSONArray

/**
 * JavaScript ↔ Android Native 桥接
 *
 * 暴露给 WebView 中 JS 调用的原生能力：
 * - 扫码
 * - Token 存取
 * - 文件选择（通过系统文件选择器，支持多选）
 * - 前台服务控制
 *
 * Web 端调用方式：window.QuickDropBridge.<method>()
 */
class JSBridge(private val webView: WebView) {

    private val tokenManager = QuickDropApplication.instance.tokenManager

    /**
     * 文件选择回调 — 由 MainActivity 注入
     * 用于触发系统文件选择器（需要 Activity 级别的 ActivityResultLauncher）
     */
    var filePickerCallback: (() -> Unit)? = null

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
     * 选择文件（触发 Android 系统文件选择器，支持多选）
     * JS 调用: QuickDropBridge.pickFiles()
     *
     * 依赖 MainActivity 注入的 filePickerCallback 来启动 ActivityResultLauncher。
     * 结果通过 onFilesPicked() 回调给 JS 的 onNativeFilePicked(filePathsJson)。
     */
    @JavascriptInterface
    fun pickFiles() {
        filePickerCallback?.invoke()
    }

    /**
     * 文件选择完成回调（由 MainActivity 在收到文件选择结果后调用）
     * @param filePaths 可访问的文件路径列表（已从 content URI 复制到临时目录）
     */
    fun onFilesPicked(filePaths: List<String>) {
        val jsonArray = JSONArray(filePaths)
        val escaped = escapeForJS(jsonArray.toString())
        webView.post {
            webView.evaluateJavascript(
                "if(typeof onNativeFilePicked === 'function') onNativeFilePicked('$escaped')",
                null
            )
        }
    }

    /**
     * JS 字符串转义 — 用于安全地注入 JS 代码
     * 对应 iOS JSBridge.escapeForJS()
     */
    private fun escapeForJS(str: String): String {
        return str
            .replace("\\", "\\\\")
            .replace("'", "\\'")
            .replace("\n", "\\n")
            .replace("\r", "\\r")
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
