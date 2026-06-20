// ============================================================
// 桌面客户端 — 设备列表页面
// 功能：同账户设备列表、临时配对设备、远程移除、连接通道指示
// ============================================================

import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuthStore } from "../stores/authStore";
import { useDeviceStore } from "../stores/deviceStore";
import { wsService } from "../services/websocket";
import { webrtcService } from "../services/webrtc";
import { fetchDevices, logout as apiLogout, removeDevice as apiRemoveDevice } from "../services/api";
import type { DeviceInfo, ConnectionChannel } from "../../../shared/types/index";

export default function DeviceListPage() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const currentDevice = useAuthStore((s) => s.currentDevice);
  const logout = useAuthStore((s) => s.logout);
  const { myDevices, pairedDevices, loading, setDevices, removeDevice } = useDeviceStore();

  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [logoutAll, setLogoutAll] = useState(false);

  // 远程移除确认状态
  const [removeTarget, setRemoveTarget] = useState<DeviceInfo | null>(null);
  const [removing, setRemoving] = useState(false);

  useEffect(() => {
    loadDevices();
    wsService.connect();
  }, []);

  const loadDevices = async () => {
    try {
      const result = await fetchDevices();
      setDevices(
        result.my_devices as DeviceInfo[],
        result.paired_devices as DeviceInfo[],
      );
    } catch (err) {
      console.error("Failed to load devices:", err);
    }
  };

  const handleLogout = async () => {
    try {
      await apiLogout(logoutAll);
    } catch {
      // 即使请求失败也清理本地状态
    }
    wsService.disconnect();
    logout();
    navigate("/login");
  };

  const handleDeviceClick = (device: DeviceInfo) => {
    if (device.is_online) {
      navigate(`/transfer/${device.id}`);
    }
  };

  const handleRemoveDevice = async () => {
    if (!removeTarget) return;
    setRemoving(true);
    try {
      await apiRemoveDevice(removeTarget.id);
      removeDevice(removeTarget.id);
      setRemoveTarget(null);
    } catch (err) {
      console.error("Failed to remove device:", err);
    } finally {
      setRemoving(false);
    }
  };

  const getChannelLabel = (device: DeviceInfo): { channel: ConnectionChannel; label: string } => {
    // 优先使用 WebRTC 服务检测到的实际连接通道
    const detectedChannel = webrtcService.getConnectionChannel(device.id)
      || (device as any).connection_channel as ConnectionChannel | undefined;

    const channel = detectedChannel || "lan_p2p";

    switch (channel) {
      case "lan_p2p": return { channel: "lan_p2p", label: "局域网" };
      case "bluetooth": return { channel: "bluetooth", label: "蓝牙" };
      case "turn_relay": return { channel: "turn_relay", label: "中继" };
      default: return { channel: "lan_p2p", label: "局域网" };
    }
  };

  const getChannelClass = (channel: ConnectionChannel): string => {
    switch (channel) {
      case "lan_p2p":
        return "channel-lan";
      case "bluetooth":
        return "channel-bluetooth";
      case "turn_relay":
        return "channel-relay";
      default:
        return "channel-lan";
    }
  };

  const getDeviceIcon = (device: DeviceInfo): string => {
    switch (device.device_type) {
      case "phone": return "📱";
      case "tablet": return "📋";
      default: return "💻";
    }
  };

  const formatTime = (isoStr: string): string => {
    try {
      return new Date(isoStr).toLocaleString();
    } catch {
      return isoStr;
    }
  };

  // 分离当前设备和其他设备
  const otherDevices = myDevices.filter((d) => d.id !== currentDevice?.id);
  const onlineOthers = otherDevices.filter((d) => d.is_online);
  const offlineOthers = otherDevices.filter((d) => !d.is_online);

  return (
    <div className="page-container" style={{ maxWidth: 640 }}>
      {/* 顶部栏 */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700 }}>我的设备</h1>
          <p style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>{user?.email}</p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            className="btn-ghost"
            onClick={() => navigate("/history")}
            style={{ fontSize: 13 }}
          >
            传输历史
          </button>
          <button
            className="btn-ghost"
            onClick={() => navigate("/settings")}
            style={{ fontSize: 13 }}
          >
            设置
          </button>
          <button className="btn-ghost" onClick={() => setShowLogoutConfirm(true)}>
            退出
          </button>
        </div>
      </div>

      {loading && <p style={{ textAlign: "center", color: "var(--color-text-secondary)" }}>加载中...</p>}

      {/* 本机 */}
      {currentDevice && (
        <div className="card" style={{ marginBottom: 12, background: "var(--color-surface-hover)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{ fontSize: 24 }}>{getDeviceIcon(currentDevice)}</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600 }}>{currentDevice.device_name}（本机）</div>
              <div style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>
                {currentDevice.os} · 当前设备
              </div>
            </div>
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: "var(--color-success)",
              }}
            />
          </div>
        </div>
      )}

      {/* 在线设备 */}
      <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 8, marginTop: 20 }}>
        在线设备（{onlineOthers.length}）
      </h2>
      {onlineOthers.length === 0 && !loading && (
        <p style={{ color: "var(--color-text-secondary)", fontSize: 13, padding: 12 }}>
          暂无其他在线设备。在其他设备上登录同一账号即可自动配对。
        </p>
      )}
      {onlineOthers.map((device) => {
        const { channel, label } = getChannelLabel(device);
        return (
          <div
            key={device.id}
            className="card"
            style={{ marginBottom: 8, cursor: "pointer" }}
            onClick={() => handleDeviceClick(device)}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <span style={{ fontSize: 24 }}>{getDeviceIcon(device)}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600 }}>{device.device_name}</div>
                <div style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>
                  {device.os} · 首次: {formatTime(device.first_seen)}
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span className={`channel-badge ${getChannelClass(channel)}`}>{label}</span>
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: "50%",
                    background: "var(--color-success)",
                  }}
                />
              </div>
            </div>
            {/* 操作按钮 */}
            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 8 }}>
              <button
                className="btn-ghost"
                style={{ fontSize: 12, color: "var(--color-error)", padding: "2px 8px" }}
                onClick={(e) => {
                  e.stopPropagation();
                  setRemoveTarget(device);
                }}
              >
                移除设备
              </button>
            </div>
          </div>
        );
      })}

      {/* 离线设备 (设备管理) */}
      {offlineOthers.length > 0 && (
        <>
          <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 8, marginTop: 20 }}>
            离线设备（{offlineOthers.length}）
          </h2>
          {offlineOthers.map((device) => (
            <div
              key={device.id}
              className="card"
              style={{ marginBottom: 8, opacity: 0.65, cursor: "default" }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <span style={{ fontSize: 24 }}>{getDeviceIcon(device)}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600 }}>{device.device_name}</div>
                  <div style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>
                    {device.os} · 首次: {formatTime(device.first_seen)} · 最后: {formatTime(device.last_seen)}
                  </div>
                </div>
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: "50%",
                    background: "var(--color-text-secondary)",
                  }}
                />
              </div>
              <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 8 }}>
                <button
                  className="btn-ghost"
                  style={{ fontSize: 12, color: "var(--color-error)", padding: "2px 8px" }}
                  onClick={(e) => {
                    e.stopPropagation();
                    setRemoveTarget(device);
                  }}
                >
                  移除设备
                </button>
              </div>
            </div>
          ))}
        </>
      )}

      {/* 临时配对设备 */}
      {pairedDevices.length > 0 && (
        <>
          <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 8, marginTop: 20 }}>
            临时配对设备（{pairedDevices.length}）
          </h2>
          {pairedDevices.map((device) => {
            const { channel, label } = getChannelLabel(device);
            return (
              <div
                key={device.id}
                className="card"
                style={{ marginBottom: 8, cursor: device.is_online ? "pointer" : "default" }}
                onClick={() => handleDeviceClick(device)}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <span style={{ fontSize: 24 }}>{getDeviceIcon(device)}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600 }}>{device.device_name}</div>
                    <div style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>
                      {device.os} · 临时配对
                    </div>
                  </div>
                  <span className={`channel-badge ${getChannelClass(channel)}`}>{label}</span>
                </div>
              </div>
            );
          })}
        </>
      )}

      {/* 退出登录确认弹窗 */}
      {showLogoutConfirm && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.3)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 100,
          }}
          onClick={() => setShowLogoutConfirm(false)}
        >
          <div className="card" style={{ maxWidth: 360, width: "100%" }} onClick={(e) => e.stopPropagation()}>
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
              <button className="btn-ghost" onClick={() => setShowLogoutConfirm(false)}>
                取消
              </button>
              <button className="btn-danger" onClick={handleLogout}>
                确认退出
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 远程移除确认弹窗 */}
      {removeTarget && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.3)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 100,
          }}
          onClick={() => setRemoveTarget(null)}
        >
          <div className="card" style={{ maxWidth: 360, width: "100%" }} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ marginBottom: 12 }}>移除设备</h3>
            <p style={{ fontSize: 13, color: "var(--color-text-secondary)", marginBottom: 16 }}>
              确定要移除设备 <strong>{removeTarget.device_name}</strong> 吗？该设备将被强制下线，所有登录会话将失效。
            </p>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button className="btn-ghost" onClick={() => setRemoveTarget(null)} disabled={removing}>
                取消
              </button>
              <button className="btn-danger" onClick={handleRemoveDevice} disabled={removing}>
                {removing ? "移除中..." : "确认移除"}
              </button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        .channel-badge {
          font-size: 11px;
          padding: 2px 8px;
          border-radius: 12px;
          color: white;
          font-weight: 500;
        }
        .channel-lan { background: var(--color-channel-lan); }
        .channel-bluetooth { background: var(--color-channel-bluetooth); }
        .channel-relay { background: var(--color-channel-relay); }
      `}</style>
    </div>
  );
}
