// ============================================================
// 桌面客户端 — 应用外壳布局
// 侧边栏导航 + 主内容区
// ============================================================

import { useCallback, useEffect, useState, useRef } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAuthStore } from "../stores/authStore";
import { useDeviceStore } from "../stores/deviceStore";
import { wsService } from "../services/websocket";
import { webrtcService, type WebRTCEvent } from "../services/webrtc";
import { fileTransferService } from "../services/fileTransfer";
import { useTransferHistoryStore } from "../stores/transferHistoryStore";
import { fetchDevices, logout as apiLogout } from "../services/api";
import { ReceiveDialog } from "./ReceiveDialog";
import type { DeviceInfo, TransferProgress } from "../../../shared/types/index";

export default function AppLayout() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const currentDevice = useAuthStore((s) => s.currentDevice);
  const logout = useAuthStore((s) => s.logout);
  const setDevices = useDeviceStore((s) => s.setDevices);

  const [showLogoutDialog, setShowLogoutDialog] = useState(false);
  const [logoutAll, setLogoutAll] = useState(false);
  const [receivingDeviceId, setReceivingDeviceId] = useState<string | null>(null);
  const [receiveProgress, setReceiveProgress] = useState<TransferProgress | null>(null);
  const pendingDcRef = useRef<RTCDataChannel | null>(null);
  const acceptedRef = useRef(false);
  const recvFileSizeRef = useRef(0);
  const receivingDeviceIdRef = useRef<string | null>(null);
  const savedBlobRef = useRef<{ blob: Blob; name: string } | null>(null);

  const triggerSave = () => {
    const s = savedBlobRef.current;
    if (!s) return;
    const url = URL.createObjectURL(s.blob);
    const a = document.createElement("a"); a.href = url; a.download = s.name;
    document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
    savedBlobRef.current = null;
  };

  const isAdmin = (user as any)?.is_admin ?? false;

  // 连接 WebSocket 并加载设备列表
  const loadDevices = useCallback(async () => {
    try {
      const result = await fetchDevices();
      setDevices(
        result.my_devices as DeviceInfo[],
        result.paired_devices as DeviceInfo[],
      );
    } catch (err) {
      console.error("Failed to load devices:", err);
    }
  }, [setDevices]);

  useEffect(() => {
    loadDevices();
    wsService.connect();
    wsService.setDeviceChangeCallback(loadDevices);

    // 全局接收监听（事件总线，不会被覆盖）
    // 策略：DataChannel 打开时不弹窗，等收到第一个文件数据（onProgress）才弹
    const onReceive = (ev: WebRTCEvent) => {
      if (ev.type !== "datachannel_open") return;
      if (window.location.pathname.startsWith("/transfer/")) return;
      if (receivingDeviceIdRef.current) return;

      const { deviceId: devId, dc } = ev;

      // 清除旧传输残留
      fileTransferService.clearInterruptedForDevice(devId);

      pendingDcRef.current = dc;
      acceptedRef.current = false;
      recvFileSizeRef.current = 0;
      savedBlobRef.current = null;

      let dialogShown = false;
      const showDialog = () => {
        if (dialogShown) return; dialogShown = true;
        receivingDeviceIdRef.current = devId;
        setReceivingDeviceId(devId);
        console.log(`📥 AppLayout receive: ${devId.slice(0, 8)}`);
      };
      let cleaned = false;
      const cleanup = () => {
        if (cleaned) return; cleaned = true;
        receivingDeviceIdRef.current = null;
        setReceivingDeviceId(null);
        setReceiveProgress(null);
        clearTimeout(autoCloseTimer);
      };

      const saveFile = (_fn: string, blob: Blob) => {
        savedBlobRef.current = { blob, name: _fn };
        if (acceptedRef.current) triggerSave();
      };

      const autoCloseTimer = setTimeout(() => {
        if (!acceptedRef.current) cleanup();
      }, 30_000);

      fileTransferService.setReceiveCallbacks(dc, {
        onProgress: (p) => {
          console.log(`📥 progress: ${p.file_name} ${p.percentage}% status=${p.status}`);
          recvFileSizeRef.current = p.total_bytes;
          setReceiveProgress(p);
          if (p.file_name) showDialog();
        },
        onComplete: (r) => {
          console.log(`📥 onComplete: ${r.file_name} success=${r.success}`);
          clearTimeout(autoCloseTimer);
          // 标记进度为已完成
          setReceiveProgress({ file_name: r.file_name, total_bytes: recvFileSizeRef.current, status: "completed" as any, percentage: 100, transferred_bytes: recvFileSizeRef.current, speed_bps: 0, eta_seconds: 0, file_id: r.file_id });
          if (acceptedRef.current) {
            useTransferHistoryStore.getState().addRecord({
              id: `${r.file_id}-${Date.now()}`,
              fileName: r.file_name, fileSize: recvFileSizeRef.current,
              deviceName: "接收文件", direction: "received",
              timestamp: new Date().toISOString(),
              status: r.success ? "success" : "failed",
              sha256Match: r.sha256_match,
              errorMessage: r.error_message,
              filePath: `~/Downloads/${r.file_name}`,
            } as any);
          }
          // 保留弹窗，让用户看到完成状态并可保存/关闭
        },
        onError: (fid, err) => { console.log(`📥 onError: ${fid} ${err}`); cleanup(); },
        onSaveNeeded: saveFile,
      });
    };

    webrtcService.on(onReceive);
    return () => {
      webrtcService.off(onReceive);
      wsService.setDeviceChangeCallback(null);
    };
  }, [loadDevices]);

  const handleLogout = async () => {
    try {
      await apiLogout(logoutAll);
    } catch { /* 即使失败也清理本地 */ }
    wsService.disconnect();
    logout();
    navigate("/login");
  };

  const navItems = [
    { path: "/devices", icon: "💻", label: "我的设备" },
    { path: "/history", icon: "📋", label: "传输历史" },
    { path: "/settings", icon: "⚙️", label: "设置" },
    ...(isAdmin ? [{ path: "/admin", icon: "🔧", label: "管理面板" }] : []),
  ];

  return (
    <div className="app-layout">
      {/* 侧边栏 */}
      <aside className="sidebar">
        <div className="sidebar-brand">
          <div className="sidebar-brand-icon">⚡</div>
          QuickDrop
        </div>

        <nav className="sidebar-nav">
          {navItems.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              className={({ isActive }) =>
                `sidebar-nav-item${isActive ? " active" : ""}`
              }
            >
              <span className="nav-icon">{item.icon}</span>
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="sidebar-footer">
          <div className="sidebar-user">
            <div className="sidebar-user-email">{user?.email}</div>
            <div className="sidebar-user-device">
              {currentDevice?.device_name} · {currentDevice?.os}
            </div>
          </div>
          <button
            className="sidebar-logout"
            onClick={() => setShowLogoutDialog(true)}
          >
            <span>🚪</span>
            退出登录
          </button>
        </div>
      </aside>

      {/* 主内容区 */}
      <main className="main-content">
        <div className="main-content-inner">
          <Outlet />
        </div>
      </main>

      {/* 文件接收弹窗（接收回调已在全局 handler 中设置，此处仅 UI） */}
      {receivingDeviceId && (
        <ReceiveDialog
          deviceId={receivingDeviceId}
          progress={receiveProgress}
          onAccept={() => {
            acceptedRef.current = true;
            triggerSave();
            // 通知发送方：接收方已确认
            const dc = pendingDcRef.current;
            if (dc && dc.readyState === "open") {
              try { dc.send(JSON.stringify({ type: "accept" })); } catch {}
            }
          }}
          onDecline={() => { acceptedRef.current = false; receivingDeviceIdRef.current = null; setReceivingDeviceId(null); setReceiveProgress(null); savedBlobRef.current = null; }}
          onClose={() => { triggerSave(); receivingDeviceIdRef.current = null; setReceivingDeviceId(null); setReceiveProgress(null); }}
        />
      )}

      {/* 退出确认弹窗 */}
      {showLogoutDialog && (
        <div className="modal-overlay" onClick={() => setShowLogoutDialog(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()} style={{ padding: 24 }}>
            <h3 style={{ marginBottom: 16 }}>确认退出</h3>
            <p style={{ fontSize: 13, color: "var(--color-text-secondary)", marginBottom: 16 }}>
              退出后需要重新登录才能使用 QuickDrop。
            </p>
            <div className="form-group">
              <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={logoutAll}
                  onChange={(e) => setLogoutAll(e.target.checked)}
                  style={{ width: "auto" }}
                />
                <span style={{ fontSize: 14 }}>退出所有设备</span>
              </label>
            </div>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button className="btn-ghost" onClick={() => setShowLogoutDialog(false)}>
                取消
              </button>
              <button className="btn-danger" onClick={handleLogout}>
                确认退出
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
