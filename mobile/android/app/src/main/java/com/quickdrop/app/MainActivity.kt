package com.quickdrop.app

import android.net.Uri
import android.os.Bundle
import android.webkit.WebView
import android.widget.ProgressBar
import androidx.activity.ComponentActivity
import androidx.activity.result.contract.ActivityResultContracts
import com.quickdrop.app.webview.JSBridge
import com.quickdrop.app.webview.WebViewConfig
import java.io.File
import java.io.FileOutputStream

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

    /**
     * 系统文件选择器（支持多选任意类型文件）
     * 对应 iOS 的 UIDocumentPickerViewController
     */
    private val filePickerLauncher = registerForActivityResult(
        ActivityResultContracts.OpenMultipleDocuments()
    ) { uris: List<Uri> ->
        handleFilePickerResults(uris)
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        webView = findViewById(R.id.webview)
        loadingProgress = findViewById(R.id.loading_progress)

        // 初始化 JS Bridge 并注册到 Application（供其他组件回调）
        jsBridge = JSBridge(webView)
        (application as QuickDropApplication).jsBridge = jsBridge

        // 注入文件选择器回调 — 当 JS 调用 pickFiles() 时触发系统文件选择器
        jsBridge.filePickerCallback = {
            filePickerLauncher.launch(arrayOf("*/*"))
        }

        // 配置 WebView（WebRTC、JS、DOM Storage）
        WebViewConfig.configure(webView, jsBridge)

        // 加载前端页面
        // 开发环境：加载本地开发服务器
        // 生产环境：加载打包后的 assets
        val url = if (com.quickdrop.app.BuildConfig.DEBUG) {
            "http://10.0.2.2:1420" // Vite 开发服务器（与 iOS AppConfig 端口一致）
        } else {
            "file:///android_asset/web/index.html"
        }
        webView.loadUrl(url)
    }

    /**
     * 处理文件选择结果
     *
     * 将选中的 content:// URI 文件复制到 App 临时目录，
     * 确保 WebView/WebRTC 可以通过文件路径访问文件内容。
     * 对应 iOS JSBridge.documentPicker(_:didPickDocumentsAt:) 的安全范围资源处理。
     */
    private fun handleFilePickerResults(uris: List<Uri>) {
        val accessiblePaths = mutableListOf<String>()

        for (uri in uris) {
            try {
                val fileName = resolveFileName(uri)
                val tempFile = File(cacheDir, "quickdrop_$fileName")

                contentResolver.openInputStream(uri)?.use { input ->
                    FileOutputStream(tempFile).use { output ->
                        input.copyTo(output)
                    }
                }

                accessiblePaths.add(tempFile.absolutePath)
            } catch (e: Exception) {
                // 跳过无法读取的文件
                android.util.Log.w("MainActivity", "Failed to copy picked file: $uri", e)
            }
        }

        jsBridge.onFilesPicked(accessiblePaths)
    }

    /**
     * 从 content URI 解析原始文件名
     */
    private fun resolveFileName(uri: Uri): String {
        val cursor = contentResolver.query(uri, null, null, null, null)
        cursor?.use {
            if (it.moveToFirst()) {
                val nameIndex = it.getColumnIndex(android.provider.OpenableColumns.DISPLAY_NAME)
                if (nameIndex >= 0) {
                    return it.getString(nameIndex) ?: "file_${System.currentTimeMillis()}"
                }
            }
        }
        return "file_${System.currentTimeMillis()}"
    }

    override fun onBackPressed() {
        if (webView.canGoBack()) {
            webView.goBack()
        } else {
            super.onBackPressed()
        }
    }
}
