/**
 * QuickDrop 平台适配器
 *
 * 为不同平台提供统一 API：
 * - Desktop (Tauri): window.__TAURI__
 * - Android: window.QuickDropBridge (WebView JSBridge)
 * - iOS: window.webkit.messageHandlers (WKWebView Bridge)
 *
 * Web UI 通过此适配器调用原生能力，无需关心平台差异。
 */
(function () {
  "use strict";

  const platform = detectPlatform();
  window.__QUICKDROP_PLATFORM__ = platform;

  /**
   * 检测当前运行平台
   */
  function detectPlatform() {
    const ua = navigator.userAgent;

    // Tauri 桌面端
    if (window.__TAURI__) {
      return "desktop";
    }

    // Android WebView
    if (ua.includes("Android") && window.QuickDropBridge) {
      return "android";
    }

    // iOS WKWebView
    if (
      /iPad|iPhone|iPod/.test(ua) &&
      window.webkit?.messageHandlers?.quickdrop
    ) {
      return "ios";
    }

    // 浏览器开发环境
    return "browser";
  }

  /**
   * 统一原生 API
   */
  window.QuickDropNative = {
    platform,

    // === Token 管理 ===

    saveTokens(accessToken, refreshToken) {
      switch (platform) {
        case "desktop":
          localStorage.setItem("qd_access_token", accessToken);
          localStorage.setItem("qd_refresh_token", refreshToken);
          break;
        case "android":
          window.QuickDropBridge.saveToken(accessToken, refreshToken);
          break;
        case "ios":
          window.webkit.messageHandlers.quickdrop.postMessage({
            action: "saveTokens",
            accessToken,
            refreshToken,
          });
          break;
      }
    },

    getAccessToken() {
      switch (platform) {
        case "desktop":
          return localStorage.getItem("qd_access_token") || "";
        case "android":
          return window.QuickDropBridge.getAccessToken();
        case "ios":
          // iOS: 同步调用不支持，需通过异步方式
          // 实际使用中通过 nativeTokensReady 回调获取
          return "";
        default:
          return localStorage.getItem("qd_access_token") || "";
      }
    },

    getRefreshToken() {
      switch (platform) {
        case "desktop":
          return localStorage.getItem("qd_refresh_token") || "";
        case "android":
          return window.QuickDropBridge.getRefreshToken();
        default:
          return localStorage.getItem("qd_refresh_token") || "";
      }
    },

    clearTokens() {
      switch (platform) {
        case "desktop":
          localStorage.removeItem("qd_access_token");
          localStorage.removeItem("qd_refresh_token");
          break;
        case "android":
          window.QuickDropBridge.clearTokens();
          break;
        case "ios":
          window.webkit.messageHandlers.quickdrop.postMessage({
            action: "clearTokens",
          });
          break;
      }
    },

    // === 扫码 ===

    startQRScanner() {
      switch (platform) {
        case "android":
          window.QuickDropBridge.startQRScanner();
          break;
        case "ios":
          window.webkit.messageHandlers.quickdrop.postMessage({
            action: "startQRScanner",
          });
          break;
        default:
          console.warn("扫码功能仅支持移动端");
      }
    },

    // === 文件选择 ===

    pickFiles() {
      switch (platform) {
        case "android":
          window.QuickDropBridge.pickFiles();
          break;
        case "ios":
          window.webkit.messageHandlers.quickdrop.postMessage({
            action: "pickFiles",
          });
          break;
        case "desktop":
          // Tauri 文件选择由 Rust 后端处理
          break;
        default:
          // 浏览器：使用 input[type=file]
          const input = document.createElement("input");
          input.type = "file";
          input.multiple = true;
          input.click();
      }
    },

    // === 服务地址 ===

    getAuthBaseUrl() {
      if (platform === "android") {
        return window.QuickDropBridge.getAuthBaseUrl();
      }
      if (platform === "ios") {
        return window.__QUICKDROP_CONFIG__?.authBaseUrl || "";
      }
      // 桌面端/浏览器：由构建配置提供
      return (
        window.__QUICKDROP_CONFIG__?.authBaseUrl || "http://localhost:3001"
      );
    },

    getSignalWsUrl() {
      if (platform === "android") {
        return window.QuickDropBridge.getSignalWsUrl();
      }
      if (platform === "ios") {
        return window.__QUICKDROP_CONFIG__?.signalWsUrl || "";
      }
      return (
        window.__QUICKDROP_CONFIG__?.signalWsUrl || "ws://localhost:3002"
      );
    },
  };

  // ============================================================
  // 原生回调处理
  // ============================================================

  /**
   * 原生层注入已保存的 Token
   * Android 调用: onNativeTokensReady(accessToken, refreshToken)
   * iOS 将通过相同方式调用
   */
  window.onNativeTokensReady = function (accessToken, refreshToken) {
    window.dispatchEvent(
      new CustomEvent("quickdrop:tokensReady", {
        detail: { accessToken, refreshToken },
      })
    );
  };

  /**
   * 扫码结果回调
   * Android 调用: onQRCodeScanned(qrData)
   */
  window.onQRCodeScanned = function (qrData) {
    window.dispatchEvent(
      new CustomEvent("quickdrop:qrScanned", {
        detail: { qrData },
      })
    );
  };

  /**
   * 文件选择回调
   * 原生层调用: onNativeFilePicked(fileUris)
   */
  window.onNativeFilePicked = function (fileUris) {
    window.dispatchEvent(
      new CustomEvent("quickdrop:filesPicked", {
        detail: { files: JSON.parse(fileUris || "[]") },
      })
    );
  };

  console.log(`[QuickDrop] Platform: ${platform}`);
})();
