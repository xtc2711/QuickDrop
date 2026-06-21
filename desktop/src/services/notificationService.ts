// ============================================================
// 桌面客户端 — 系统通知服务
// 使用 Web Notification API 在传输完成/失败时发送通知
// ============================================================

/**
 * 请求通知权限（在用户登录后调用）
 */
export async function requestNotificationPermission(): Promise<boolean> {
  if (!("Notification" in window)) {
    console.debug("浏览器不支持 Notification API");
    return false;
  }

  if (Notification.permission === "granted") {
    return true;
  }

  if (Notification.permission === "denied") {
    return false;
  }

  const permission = await Notification.requestPermission();
  return permission === "granted";
}

/**
 * 发送传输完成通知
 */
export function notifyTransferComplete(
  fileName: string,
  direction: "sent" | "received",
): void {
  if (!("Notification" in window) || Notification.permission !== "granted") return;

  const verb = direction === "sent" ? "已发送" : "已接收";
  const icon = direction === "sent" ? "📤" : "📥";

  try {
    new Notification(`${icon} 传输完成`, {
      body: `${fileName} ${verb}，SHA256 校验通过 ✓`,
      tag: "quickdrop-transfer",
      silent: false,
    });
  } catch {
    // 通知失败静默处理（如 service worker 未注册）
  }
}

/**
 * 发送传输失败通知
 */
export function notifyTransferFailed(
  fileName: string,
  errorMessage?: string,
): void {
  if (!("Notification" in window) || Notification.permission !== "granted") return;

  try {
    new Notification("❌ 传输失败", {
      body: errorMessage
        ? `${fileName} 传输失败: ${errorMessage}`
        : `${fileName} 传输失败`,
      tag: "quickdrop-transfer",
      silent: false,
    });
  } catch {
    // 通知失败静默处理
  }
}

/**
 * 发送新设备上线通知
 */
export function notifyDeviceOnline(deviceName: string): void {
  if (!("Notification" in window) || Notification.permission !== "granted") return;

  try {
    new Notification("🆕 设备上线", {
      body: `${deviceName} 已上线，可以开始传输`,
      tag: "quickdrop-device",
      silent: true,
    });
  } catch {
    // 通知失败静默处理
  }
}
