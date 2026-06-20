import Foundation

/// QuickDrop 编译配置
///
/// 通过编译条件切换开发/生产环境地址
/// 对应 Android 的 BuildConfig
enum AppConfig {
    /// 认证服务基础 URL
    static var authBaseUrl: String {
        #if DEBUG
        return "http://localhost:3001/api/v1"
        #else
        return "https://signal.quickdrop.app/api/v1"
        #endif
    }

    /// 信令服务 WebSocket URL
    static var signalWsUrl: String {
        #if DEBUG
        return "ws://localhost:3002"
        #else
        return "wss://signal.quickdrop.app"
        #endif
    }

    /// Web 前端入口 URL
    /// - Debug: 本地 Vite 开发服务器
    /// - Release: 内嵌 web assets
    static var webEntryUrl: String {
        #if DEBUG
        return "http://localhost:5173"
        #else
        // 从 app bundle 加载 web 资源
        if let webPath = Bundle.main.path(forResource: "index", ofType: "html", inDirectory: "web") {
            return URL(fileURLWithPath: webPath).absoluteString
        }
        return "about:blank"
        #endif
    }
}
