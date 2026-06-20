import UIKit

/// Scene Delegate (iOS 13+)
///
/// 管理多窗口场景（iPad 多窗口支持预留）
final class SceneDelegate: UIResponder, UIWindowSceneDelegate {

    var window: UIWindow?

    func scene(
        _ scene: UIScene,
        willConnectTo session: UISceneSession,
        options connectionOptions: UIScene.ConnectionOptions
    ) {
        guard let windowScene = (scene as? UIWindowScene) else { return }

        let window = UIWindow(windowScene: windowScene)
        window.backgroundColor = .white

        let mainVC = MainViewController()
        window.rootViewController = mainVC
        window.makeKeyAndVisible()
        self.window = window
    }
}
