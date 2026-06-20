# QuickDrop iOS

跨平台 P2P 文件传输工具 — iOS 客户端

## 架构

以 WKWebView 承载全部 UI 逻辑，与桌面端共享 Web 前端代码。
原生层通过 JSBridge 提供系统能力：

| 原生能力 | 实现方式 | Web 调用 |
|---------|---------|---------|
| Token 安全存储 | Keychain Services | `messageHandlers.quickdrop.postMessage({action:"saveTokens",...})` |
| 二维码扫描 | AVFoundation CIDetector | `messageHandlers.quickdrop.postMessage({action:"startQRScanner"})` |
| 文件选择 | UIDocumentPickerViewController | `messageHandlers.quickdrop.postMessage({action:"pickFiles"})` |
| WebRTC | WKWebView 原生支持 | 标准 WebRTC API |

## 项目结构

```
ios/
├── QuickDrop/                       # 主源码
│   ├── AppDelegate.swift            # @main 入口
│   ├── SceneDelegate.swift          # 场景管理（iPad 多窗口预留）
│   ├── MainViewController.swift     # 主控制器（WKWebView 容器）
│   ├── Bridge/
│   │   └── JSBridge.swift           # JS ↔ Native 桥接
│   ├── Auth/
│   │   └── TokenManager.swift       # Keychain Token 存储
│   ├── Camera/
│   │   └── QRScannerViewController.swift  # 二维码扫描
│   ├── Config/
│   │   └── AppConfig.swift          # 编译配置
│   ├── Assets.xcassets/             # 图标与资源
│   └── Info.plist                   # 应用配置
├── Resources/
│   └── web/                         # Web 前端资源（与 Android 共享）
│       ├── index.html
│       ├── platform-adapter.js
│       └── mobile-styles.css
├── project.yml                      # XcodeGen 项目配置
└── README.md
```

## 环境要求

- macOS 14+
- Xcode 15.0+
- iOS 16.0+ 部署目标
- [XcodeGen](https://github.com/yonaskolb/XcodeGen)（可选，用于生成 .xcodeproj）

## 快速开始

### 1. 生成 Xcode 项目

```bash
# 安装 XcodeGen（如未安装）
brew install xcodegen

# 生成 .xcodeproj
cd mobile/ios
xcodegen generate
```

### 2. 手动创建 Xcode 项目

如果不想使用 XcodeGen：
1. 打开 Xcode → New Project → iOS → App
2. Product Name: `QuickDrop`
3. Interface: `Storyboard`, Language: `Swift`
4. 将 `QuickDrop/` 下所有 `.swift` 文件加入项目
5. 将 `Resources/web/` 添加为 Folder Reference（Create folder references）
6. 在 `Info.plist` 中添加相机、相册、本地网络等权限描述

### 3. 开发运行

```bash
# Debug 模式：连接本地 Vite 开发服务器
# 先启动桌面端 Vite dev server
cd desktop && npm run dev

# 然后在 Xcode 中运行 QuickDrop target（Debug 配置）
# WKWebView 会自动加载 http://localhost:5173
```

### 4. 生产构建

```bash
# 构建 Web 前端
cd desktop && npm run build

# 将构建产物复制到 iOS Resources
cp -r desktop/dist/* mobile/ios/Resources/web/

# 在 Xcode 中 Archive（Release 配置）
```

## 功能对应关系（Android ↔ iOS）

| Android | iOS |
|---------|-----|
| MainActivity | MainViewController |
| QuickDropApplication | AppDelegate |
| JSBridge (JavascriptInterface) | JSBridge (WKScriptMessageHandler) |
| TokenManager (EncryptedSharedPreferences) | TokenManager (Keychain) |
| QRScannerActivity (CameraX + ML Kit) | QRScannerViewController (AVFoundation + CIDetector) |
| TransferForegroundService | (iOS 后台传输处理方式不同，暂未实现) |
| WebViewConfig | 配置内置于 MainViewController.setupWebView() |
| BuildConfig | AppConfig (DEBUG 编译条件) |

## 注意事项

1. **WebRTC**: iOS WKWebView 从 iOS 14.3+ 开始原生支持 WebRTC，无需额外配置
2. **Keychain**: Token 存储使用 `kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`，重启后首次解锁可用
3. **文件选择**: 使用 `UIDocumentPickerViewController`，选中的安全范围文件会被复制到 App 临时目录
4. **扫码**: 使用 Core Image 的 `CIDetector` 而非 Vision 框架（更轻量，兼容 iOS 16+）
5. **Xcode 项目文件**: `.xcodeproj` 由 XcodeGen 通过 `project.yml` 生成，不提交到 Git

## 已知限制

- 编译需要完整 Xcode（非 Command Line Tools）
- iOS 后台传输受限（需使用 BGTaskScheduler，Phase 2 计划）
- iPad 分屏/多窗口已预留支持但未完整测试
