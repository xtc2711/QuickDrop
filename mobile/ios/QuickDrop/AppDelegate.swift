import UIKit

/// QuickDrop iOS Application Delegate
///
/// 对应 Android 的 QuickDropApplication
@main
final class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?

    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
    ) -> Bool {

        // 开发环境启用 WebView 调试
        #if DEBUG
        if #available(iOS 16.4, *) {
            // WKWebView 调试通过 Safari Develop 菜单
            // iOS 16.4+ 自动启用 inspection
        }
        #endif

        // 创建窗口
        let window = UIWindow(frame: UIScreen.main.bounds)
        window.backgroundColor = .white

        let mainVC = MainViewController()
        window.rootViewController = mainVC
        window.makeKeyAndVisible()
        self.window = window

        return true
    }

    // MARK: - UISceneSession Lifecycle (iOS 13+)

    func application(
        _ application: UIApplication,
        configurationForConnecting connectingSceneSession: UISceneSession,
        options: UIScene.ConnectionOptions
    ) -> UISceneConfiguration {
        return UISceneConfiguration(name: "Default Configuration", sessionRole: connectingSceneSession.role)
    }
}
