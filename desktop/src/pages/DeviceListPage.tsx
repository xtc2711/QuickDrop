// ============================================================
// 桌面客户端 — 设备列表页面（桌面端网格布局）
// ============================================================

import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuthStore } from "../stores/authStore";
import { useDeviceStore } from "../stores/deviceStore";
import { webrtcService } from "../services/webrtc";
import { wsService } from "../services/websocket";
import { removeDevice as apiRemoveDevice, fetchDevices } from "../services/api";
import type { DeviceInfo, ConnectionChannel } from "../../../shared/types/index";
import PairingDialog from "../components/PairingDialog";

export default function DeviceListPage() {
  const navigate = useNavigate();
  const currentDevice = useAuthStore((s) => s.currentDevice);
  const { myDevices, pairedDevices, loading, removeDevice, removePairedDevice } = useDeviceStore();

  const [showPairing, setShowPairing] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<DeviceInfo | null>(null);
  const [removing, setRemoving] = useState(false);

  const reloadDevices = async () => {
    try {
      const r = await fetchDevices();
      useDeviceStore.getState().setDevices(
        r.my_devices as DeviceInfo[],
        r.paired_devices as DeviceInfo[],
      );
    } catch { /* ok */ }
  };

  useEffect(() => {
    wsService.setDeviceChangeCallback(() => reloadDevices());
    reloadDevices();
    return () => { wsService.setDeviceChangeCallback(null); };
  }, []);

  const handleDeviceClick = (device: DeviceInfo) => {
    if (device.is_online) navigate(`/transfer/${device.id}`);
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

  const getDeviceIcon = (d: DeviceInfo): string => {
    switch (d.device_type) { case "phone": return "📱"; case "tablet": return "📋"; default: return "💻"; }
  };

  const formatTime = (isoStr: string): string => {
    try { return new Date(isoStr).toLocaleString(); } catch { return isoStr; }
  };

  const otherDevices = myDevices.filter((d) => d.id !== currentDevice?.id);
  const onlineOthers = otherDevices.filter((d) => d.is_online);
  const offlineOthers = otherDevices.filter((d) => !d.is_online);

  return (
    <div>
      {/* 页面头部 */}
      <div className="page-header">
        <div>
          <h1 className="page-title">我的设备</h1>
          <p className="page-subtitle">
            {myDevices.length} 台设备 · {onlineOthers.length} 台在线
          </p>
        </div>
        <button className="btn-primary" onClick={() => setShowPairing(true)} style={{ padding: "8px 18px" }}>
          ＋ 配对新设备
        </button>
      </div>

      {loading && <p style={{ textAlign: "center", color: "var(--color-text-secondary)", padding: 40 }}>加载中...</p>}

      {/* 本机 */}
      {currentDevice && (
        <div className="card" style={{ marginBottom: 20, background: "var(--color-primary-light)", border: "1px solid var(--color-primary)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{ fontSize: 28 }}>{getDeviceIcon(currentDevice)}</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600, fontSize: 15 }}>{currentDevice.device_name}（本机）</div>
              <div style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>{currentDevice.os} · 当前设备</div>
            </div>
            <span className="badge badge-success">在线</span>
          </div>
        </div>
      )}

      {/* 在线设备网格 */}
      {onlineOthers.length > 0 && (
        <>
          <h2 style={{ fontSize: 15, fontWeight: 600, marginBottom: 12, marginTop: 8 }}>在线设备</h2>
          <div className="device-grid">
            {onlineOthers.map((device) => {
              const { channel, label } = getChannelLabel(device);
              return (
                <div key={device.id} className="card" style={{ cursor: "pointer" }} onClick={() => handleDeviceClick(device)}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                    <span style={{ fontSize: 24 }}>{getDeviceIcon(device)}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: 14 }}>{device.device_name}</div>
                      <div style={{ fontSize: 11, color: "var(--color-text-secondary)" }}>{device.os}</div>
                    </div>
                    <span className={`channel-badge channel-${channel === "lan_p2p" ? "lan" : channel === "bluetooth" ? "bluetooth" : "relay"}`}>
                      {label}
                    </span>
                  </div>
                  <div style={{ fontSize: 11, color: "var(--color-text-muted)", marginBottom: 8 }}>
                    首次连接: {formatTime(device.first_seen)}
                  </div>
                  <div style={{ display: "flex", justifyContent: "flex-end" }}>
                    <button
                      className="btn-ghost btn-sm"
                      style={{ color: "var(--color-danger)", fontSize: 11 }}
                      onClick={(e) => { e.stopPropagation(); setRemoveTarget(device); }}
                    >
                      移除设备
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* 离线设备 */}
      {offlineOthers.length > 0 && (
        <>
          <h2 style={{ fontSize: 15, fontWeight: 600, marginBottom: 12, marginTop: 24 }}>离线设备</h2>
          <div className="device-grid">
            {offlineOthers.map((device) => (
              <div key={device.id} className="card" style={{ opacity: 0.6 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                  <span style={{ fontSize: 24 }}>{getDeviceIcon(device)}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 14 }}>{device.device_name}</div>
                    <div style={{ fontSize: 11, color: "var(--color-text-secondary)" }}>{device.os}</div>
                  </div>
                  <span className="badge" style={{ background: "#f1f5f9", color: "#94a3b8" }}>离线</span>
                </div>
                <div style={{ fontSize: 11, color: "var(--color-text-muted)", marginBottom: 8 }}>
                  最后在线: {formatTime(device.last_seen)}
                </div>
                <div style={{ display: "flex", justifyContent: "flex-end" }}>
                  <button
                    className="btn-ghost btn-sm"
                    style={{ color: "var(--color-danger)", fontSize: 11 }}
                    onClick={(e) => { e.stopPropagation(); setRemoveTarget(device); }}
                  >
                    移除设备
                  </button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* 空状态 */}
      {!loading && onlineOthers.length === 0 && offlineOthers.length === 0 && (
        <div className="empty-state">
          <div className="empty-icon">📱</div>
          <p>暂无其他设备。在其他设备上登录同一账号即可自动配对。</p>
        </div>
      )}

      {/* 临时配对设备 */}
      {pairedDevices.length > 0 && (
        <>
          <h2 style={{ fontSize: 15, fontWeight: 600, marginBottom: 12, marginTop: 24 }}>临时配对设备</h2>
          <div className="device-grid">
            {pairedDevices.map((device) => {
              const { channel, label } = getChannelLabel(device);
              return (
                <div
                  key={device.id}
                  className="card"
                  style={{ cursor: device.is_online ? "pointer" : "default" }}
                  onClick={() => handleDeviceClick(device)}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span style={{ fontSize: 24 }}>{getDeviceIcon(device)}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: 14 }}>{device.device_name}</div>
                      <div style={{ fontSize: 11, color: "var(--color-text-secondary)" }}>{device.os} · 配对设备</div>
                    </div>
                    <span className={`channel-badge channel-${channel === "lan_p2p" ? "lan" : channel === "bluetooth" ? "bluetooth" : "relay"}`}>
                      {label}
                    </span>
                    <button
                      className="btn-ghost btn-sm"
                      style={{ color: "var(--color-danger)", fontSize: 16, padding: "2px 8px", flexShrink: 0 }}
                      onClick={(e) => { e.stopPropagation(); removePairedDevice(device.id); }}
                      title="删除配对设备">
                      ✕
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* 配对弹窗 */}
      {showPairing && (
        <PairingDialog onClose={() => setShowPairing(false)} onPaired={() => {}} />
      )}

      {/* 远程移除确认弹窗 */}
      {removeTarget && (
        <div className="modal-overlay" onClick={() => setRemoveTarget(null)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()} style={{ padding: 24 }}>
            <h3 style={{ marginBottom: 12 }}>移除设备</h3>
            <p style={{ fontSize: 13, color: "var(--color-text-secondary)", marginBottom: 16 }}>
              确定要移除设备 <strong>{removeTarget.device_name}</strong> 吗？该设备将被强制下线。
            </p>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button className="btn-ghost" onClick={() => setRemoveTarget(null)} disabled={removing}>取消</button>
              <button className="btn-danger" onClick={handleRemoveDevice} disabled={removing}>
                {removing ? "移除中..." : "确认移除"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
