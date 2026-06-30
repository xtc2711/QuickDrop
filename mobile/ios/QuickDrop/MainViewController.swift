import UIKit
import WebKit

/// QuickDrop 主视图控制器
///
/// 以 WKWebView 承载全部 UI 逻辑：
/// - 登录/注册 → 设备列表 → 文件传输
/// - 所有页面由 Web 前端渲染（与桌面端共享 UI 代码）
/// - 通过 JSBridge 调用原生能力（扫码、文件选择、Token 存储）
///
/// 对应 Android 的 MainActivity
final class MainViewController: UIViewController {

    // MARK: - Properties

    private var webView: WKWebView!
    private var jsBridge: JSBridge!
    private var loadingIndicator: UIActivityIndicatorView!

    // MARK: - Lifecycle

    override func viewDidLoad() {
        super.viewDidLoad()
        setupViewController()
        setupWebView()
        setupLoadingIndicator()
        loadWebContent()
    }

    /// 设置视图控制器为全屏模式
    private func setupViewController() {
        // 让视图延伸到安全区域外（全屏显示）
        edgesForExtendedLayout = .all
        extendedLayoutIncludesOpaqueBars = true
        additionalSafeAreaInsets = .zero
        
        // 背景色匹配 Web 页面 --color-bg，避免底部安全区域露出白色
        view.backgroundColor = UIColor(red: 0.973, green: 0.980, blue: 0.988, alpha: 1.0) // #f8fafc
    }

    // MARK: - Setup

    private func setupWebView() {
        // 创建 WebView 配置
        let config = WKWebViewConfiguration()

        // WebView 行为配置
        let prefs = WKWebpagePreferences()
        prefs.allowsContentJavaScript = true
        config.defaultWebpagePreferences = prefs

        // 允许内联播放（WebRTC 需要）
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []

        // 持久化数据存储
        config.websiteDataStore = .default()

        // 创建 WebView
        webView = WKWebView(frame: view.bounds, configuration: config)
        webView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.allowsBackForwardNavigationGestures = true

        // 禁用缩放
        webView.scrollView.maximumZoomScale = 1.0
        webView.scrollView.minimumZoomScale = 1.0

        // 延伸到安全区域底部，由 viewport-fit=cover + CSS safe-area-inset 处理
        webView.scrollView.contentInsetAdjustmentBehavior = .never

        view.addSubview(webView)

        // 创建 JSBridge 并注册为消息处理器
        jsBridge = JSBridge(webView: webView, viewController: self)
        config.userContentController.add(jsBridge, name: "quickdrop")
    }

    private func setupLoadingIndicator() {
        loadingIndicator = UIActivityIndicatorView(style: .large)
        loadingIndicator.translatesAutoresizingMaskIntoConstraints = false
        loadingIndicator.hidesWhenStopped = true
        view.addSubview(loadingIndicator)

        NSLayoutConstraint.activate([
            loadingIndicator.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            loadingIndicator.centerYAnchor.constraint(equalTo: view.centerYAnchor)
        ])
    }

    private func loadWebContent() {
        loadingIndicator.startAnimating()

        // 注入移动端 viewport 和样式（在页面加载前通过 UserScript）
        injectMobileViewport()
        injectPlatformAdapter()

        // 注入配置到 JS（在页面加载前）
        jsBridge.injectConfig()

        // 加载 Web 内容
        let urlString = AppConfig.webEntryUrl
        if let url = URL(string: urlString) {
            let request = URLRequest(
                url: url,
                cachePolicy: .useProtocolCachePolicy,
                timeoutInterval: 30
            )
            webView.load(request)
        }
    }

    /// 注入移动端 viewport meta 标签与样式，解决页面显示过小问题
    private func injectMobileViewport() {
        // 读取移动端 CSS
        var mobileCSS = ""
        if let cssPath = Bundle.main.path(forResource: "mobile-styles", ofType: "css", inDirectory: "web"),
           let css = try? String(contentsOfFile: cssPath) {
            mobileCSS = css.replacingOccurrences(of: "\\", with: "\\\\")
                             .replacingOccurrences(of: "'", with: "\\'")
                             .replacingOccurrences(of: "\n", with: "\\n")
        }

        let js = """
        (function() {
            // 移除旧 viewport，设置移动端适配
            var old = document.querySelector('meta[name="viewport"]');
            if (old) old.remove();
            var meta = document.createElement('meta');
            meta.name = 'viewport';
            meta.content = 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover';
            document.head.appendChild(meta);

            // 注入移动端 CSS（不添加 body padding，让页面自己处理）
            var style = document.createElement('style');
            style.textContent = 'html,body,#root{width:100%;height:100%;margin:0;padding:0;padding-bottom:env(safe-area-inset-bottom);box-sizing:border-box}' + '\(mobileCSS)';
            document.head.appendChild(style);
        })();
        """
        let script = WKUserScript(source: js, injectionTime: .atDocumentEnd, forMainFrameOnly: true)
        webView.configuration.userContentController.addUserScript(script)
    }

    /// 注入平台适配器，让 Web 页面识别运行环境
    private func injectPlatformAdapter() {
        guard let adapterPath = Bundle.main.path(forResource: "platform-adapter", ofType: "js", inDirectory: "web"),
              let adapterJS = try? String(contentsOfFile: adapterPath) else {
            return
        }
        let script = WKUserScript(source: adapterJS, injectionTime: .atDocumentStart, forMainFrameOnly: true)
        webView.configuration.userContentController.addUserScript(script)
    }
}

// MARK: - WKNavigationDelegate

extension MainViewController: WKNavigationDelegate {

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        loadingIndicator.stopAnimating()

        // 页面加载完成后注入 Token（如已登录）
        jsBridge.injectTokens()

        // 通知 JS 隐藏启动画面
        webView.evaluateJavaScript("if(window.__hideSplash) window.__hideSplash()")
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        loadingIndicator.stopAnimating()
        print("[MainViewController] WebView load failed: \(error.localizedDescription)")
    }

    func webView(
        _ webView: WKWebView,
        didFailProvisionalNavigation navigation: WKNavigation!,
        withError error: Error
    ) {
        loadingIndicator.stopAnimating()
        print("[MainViewController] Provisional load failed: \(error.localizedDescription)")
    }

    /// 处理导航请求（白名单/拦截）
    func webView(
        _ webView: WKWebView,
        decidePolicyFor navigationAction: WKNavigationAction,
        decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
    ) {
        decisionHandler(.allow)
    }
}

// MARK: - WKUIDelegate

extension MainViewController: WKUIDelegate {

    /// 处理 JS alert()
    func webView(
        _ webView: WKWebView,
        runJavaScriptAlertPanelWithMessage message: String,
        initiatedByFrame frame: WKFrameInfo,
        completionHandler: @escaping () -> Void
    ) {
        let alert = UIAlertController(title: nil, message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "确定", style: .default) { _ in
            completionHandler()
        })
        present(alert, animated: true)
    }

    /// 处理 JS confirm()
    func webView(
        _ webView: WKWebView,
        runJavaScriptConfirmPanelWithMessage message: String,
        initiatedByFrame frame: WKFrameInfo,
        completionHandler: @escaping (Bool) -> Void
    ) {
        let alert = UIAlertController(title: nil, message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "取消", style: .cancel) { _ in
            completionHandler(false)
        })
        alert.addAction(UIAlertAction(title: "确定", style: .default) { _ in
            completionHandler(true)
        })
        present(alert, animated: true)
    }

    /// 处理 WebRTC 摄像头/麦克风权限请求
    func webView(
        _ webView: WKWebView,
        requestMediaCapturePermissionFor origin: WKSecurityOrigin,
        initiatedByFrame frame: WKFrameInfo,
        type: WKMediaCaptureType,
        decisionHandler: @escaping (WKPermissionDecision) -> Void
    ) {
        decisionHandler(.grant)
    }
}
