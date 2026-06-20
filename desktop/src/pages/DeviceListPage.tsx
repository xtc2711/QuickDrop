// ============================================================
// 桌面客户端 — 设备列表页面
// ============================================================

import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuthStore } from "../stores/authStore";
import { useDeviceStore } from "../stores/deviceStore";
import { wsService } from "../services/websocket";
import { fetchDevices, logout as apiLogout } from "../services/api";
import type { DeviceInfo, ConnectionChannel } from "../../../../shared/types/index";

export default function DeviceListPage() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const currentDevice = useAuthStore((s) => s.currentDevice);
  const logout = useAuthStore((s) => s.logout);
  const { myDevices, pairedDevices, loading, setDevices } = useDeviceStore();

  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [logoutAll, setLogoutAll] = useState(false);

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

  const getChannelLabel = (device: DeviceInfo): { channel: ConnectionChannel; label: string } => {
    // 暂时基于设备类型推测通道（后续由信令服务上报）
    return { channel: "lan_p2p", label: "局域网" };
  };

  const getChannelClass = (channel: ConnectionChannel): string => {
    switch (channel) {
      case "lan_p2p":
        return "channel-lan";
      case "bluetooth":
        return "channel-bluetooth";
      case "turn_relay":
        return "channel-relay";
    }
  };

  return (
    <div className="page-container" style={{ maxWidth: 640 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700 }}>我的设备</h1>
          <p style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>{user?.email}</p>
        </div>
        <button className="btn-ghost" onClick={() => setShowLogoutConfirm(true)}>
          退出
        </button>
      </div>

      {loading && <p style={{ textAlign: "center", color: "var(--color-text-secondary)" }}>加载中...</p>}

      {/* 本机 */}
      {currentDevice && (
        <div className="card" style={{ marginBottom: 12, opacity: 0.8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{ fontSize: 24 }}>💻</span>
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

      {/* 同账户设备 */}
      <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 8, marginTop: 20 }}>
        我的设备（{myDevices.length}）
      </h2>
      {myDevices.length === 0 && !loading && (
        <p style={{ color: "var(--color-text-secondary)", fontSize: 13, padding: 12 }}>
          暂无其他在线设备。在其他设备上登录同一账号即可自动配对。
        </p>
      )}
      {myDevices
        .filter((d) => d.id !== currentDevice?.id)
        .map((device) => {
          const { channel, label } = getChannelLabel(device);
          return (
            <div
              key={device.id}
              className="card"
              style={{ marginBottom: 8, cursor: device.is_online ? "pointer" : "default" }}
              onClick={() => handleDeviceClick(device)}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <span style={{ fontSize: 24 }}>
                  {device.device_type === "phone" ? "📱" : device.device_type === "tablet" ? "📋" : "💻"}
                </span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600 }}>{device.device_name}</div>
                  <div style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>
                    {device.os} · 最后在线: {new Date(device.last_seen).toLocaleString()}
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span className={`channel-badge ${getChannelClass(channel)}`}>{label}</span>
                  <span
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: "50%",
                      background: device.is_online ? "var(--color-success)" : "var(--color-text-secondary)",
                    }}
                  />
                </div>
              </div>
            </div>
          );
        })}

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
                  <span style={{ fontSize: 24 }}>
                    {device.device_type === "phone" ? "📱" : device.device_type === "tablet" ? "📋" : "💻"}
                  </span>
                  <div style={{ flex: 1 }}>
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

      {/* 退出确认弹窗 */}
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
