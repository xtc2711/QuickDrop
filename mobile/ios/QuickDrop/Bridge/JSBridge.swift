import Foundation
import WebKit

/// JavaScript ↔ iOS Native 桥接
///
/// 通过 WKScriptMessageHandler 接收来自 WebView 中 JS 的调用。
/// Web 端调用方式：window.webkit.messageHandlers.quickdrop.postMessage({action: "...", ...})
///
/// 暴露给 WebView 的原生能力：
/// - Token 存取 (Keychain)
/// - 扫码 (AVFoundation)
/// - 文件选择 (UIDocumentPickerViewController)
/// - 服务地址获取
///
/// 对应 Android 的 JSBridge (JavascriptInterface)
final class JSBridge: NSObject, WKScriptMessageHandler {

    private weak var webView: WKWebView?
    private weak var viewController: UIViewController?
    private let tokenManager = TokenManager.shared

    init(webView: WKWebView, viewController: UIViewController) {
        self.webView = webView
        self.viewController = viewController
        super.init()
    }

    // MARK: - WKScriptMessageHandler

    func userContentController(
        _ userContentController: WKUserContentController,
        didReceive message: WKScriptMessage
    ) {
        guard message.name == "quickdrop",
              let body = message.body as? [String: Any],
              let action = body["action"] as? String else {
            return
        }

        switch action {
        case "saveTokens":
            handleSaveTokens(body)
        case "clearTokens":
            handleClearTokens()
        case "startQRScanner":
            handleStartQRScanner()
        case "pickFiles":
            handlePickFiles()
        case "getAuthBaseUrl":
            handleGetAuthBaseUrl()
        case "getSignalWsUrl":
            handleGetSignalWsUrl()
        case "saveReceivedFile":
            handleSaveReceivedFile(body)
        default:
            print("[JSBridge] Unknown action: \(action)")
        }
    }

    // MARK: - Action Handlers

    private func handleSaveTokens(_ body: [String: Any]) {
        let accessToken = body["accessToken"] as? String ?? ""
        let refreshToken = body["refreshToken"] as? String ?? ""
        tokenManager.saveTokens(accessToken: accessToken, refreshToken: refreshToken)
    }

    private func handleClearTokens() {
        tokenManager.clearTokens()
    }

    private func handleStartQRScanner() {
        guard let vc = viewController else { return }
        let scanner = QRScannerViewController()
        scanner.onScanResult = { [weak self] qrData in
            self?.onQRCodeScanned(qrData: qrData)
        }
        scanner.modalPresentationStyle = .fullScreen
        vc.present(scanner, animated: true)
    }

    private func handlePickFiles() {
        guard let vc = viewController else { return }
        let picker = UIDocumentPickerViewController(forOpeningContentTypes: [.data, .movie, .image, .audio, .pdf, .text])
        picker.allowsMultipleSelection = true
        picker.delegate = self
        vc.present(picker, animated: true)
    }

    private func handleSaveReceivedFile(_ body: [String: Any]) {
        guard let fileName = body["fileName"] as? String,
              let base64 = body["data"] as? String,
              let fileData = Data(base64Encoded: base64) else {
            print("[JSBridge] saveReceivedFile: invalid data")
            return
        }

        // 保存到临时目录
        let tempDir = FileManager.default.temporaryDirectory
        let fileURL = tempDir.appendingPathComponent(fileName)
        do {
            try fileData.write(to: fileURL)
            print("[JSBridge] File saved to: \(fileURL.path)")
        } catch {
            print("[JSBridge] Failed to save file: \(error)")
            return
        }

        // 在主线程弹出分享面板，让用户选择保存位置
        DispatchQueue.main.async { [weak self] in
            guard let vc = self?.viewController else { return }
            let activityVC = UIActivityViewController(activityItems: [fileURL], applicationActivities: nil)
            // iPad 适配
            if let popover = activityVC.popoverPresentationController {
                popover.sourceView = vc.view
                popover.sourceRect = CGRect(x: vc.view.bounds.midX, y: vc.view.bounds.midY, width: 0, height: 0)
            }
            vc.present(activityVC, animated: true)
        }
    }

    private func handleGetAuthBaseUrl() {
        injectJS("window.__QUICKDROP_CONFIG__ = { ...window.__QUICKDROP_CONFIG__, authBaseUrl: '\(AppConfig.authBaseUrl)' }")
    }

    private func handleGetSignalWsUrl() {
        injectJS("window.__QUICKDROP_CONFIG__ = { ...window.__QUICKDROP_CONFIG__, signalWsUrl: '\(AppConfig.signalWsUrl)' }")
    }

    // MARK: - JS Injection (Native → Web)

    /// 页面加载完成后注入已保存的 Token 到 JS
    func injectTokens() {
        guard let accessToken = tokenManager.getAccessTokenRaw(),
              let refreshToken = tokenManager.getRefreshToken() else {
            return
        }
        let escapedAccess = escapeForJS(accessToken)
        let escapedRefresh = escapeForJS(refreshToken)
        injectJS("""
        if (typeof onNativeTokensReady === 'function') {
            onNativeTokensReady('\(escapedAccess)', '\(escapedRefresh)');
        }
        """)
    }

    /// 注入配置信息到 JS
    func injectConfig() {
        let authUrl = escapeForJS(AppConfig.authBaseUrl)
        let wsUrl = escapeForJS(AppConfig.signalWsUrl)
        injectJS("""
        window.__QUICKDROP_CONFIG__ = {
            authBaseUrl: '\(authUrl)',
            signalWsUrl: '\(wsUrl)'
        };
        """)
    }

    /// 扫码结果回调给 JS
    func onQRCodeScanned(qrData: String) {
        let escaped = escapeForJS(qrData)
        injectJS("if(typeof onQRCodeScanned === 'function') onQRCodeScanned('\(escaped)')")
    }

    /// 文件选择结果回调给 JS
    func onFilesPicked(fileUris: [String]) {
        guard let jsonData = try? JSONSerialization.data(withJSONObject: fileUris),
              let jsonString = String(data: jsonData, encoding: .utf8) else { return }
        let escaped = escapeForJS(jsonString)
        injectJS("if(typeof onNativeFilePicked === 'function') onNativeFilePicked('\(escaped)')")
    }

    // MARK: - Private Helpers

    private func injectJS(_ js: String) {
        DispatchQueue.main.async { [weak self] in
            self?.webView?.evaluateJavaScript(js)
        }
    }

    /// 转义字符串用于 JS 单引号字符串内
    private func escapeForJS(_ string: String) -> String {
        return string
            .replacingOccurrences(of: "\\", with: "\\\\")
            .replacingOccurrences(of: "'", with: "\\'")
            .replacingOccurrences(of: "\n", with: "\\n")
            .replacingOccurrences(of: "\r", with: "\\r")
    }
}

// MARK: - UIDocumentPickerDelegate

extension JSBridge: UIDocumentPickerDelegate {
    func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
        // 将选中的文件复制到 App 临时目录，确保 WebRTC 可读取
        var accessibleUrls: [String] = []
        for url in urls {
            guard url.startAccessingSecurityScopedResource() else { continue }
            defer { url.stopAccessingSecurityScopedResource() }

            // 复制到临时目录
            let tempDir = FileManager.default.temporaryDirectory
            let destUrl = tempDir.appendingPathComponent(url.lastPathComponent)
            try? FileManager.default.copyItem(at: url, to: destUrl)
            accessibleUrls.append(destUrl.path)
        }
        onFilesPicked(fileUris: accessibleUrls)
    }
}
