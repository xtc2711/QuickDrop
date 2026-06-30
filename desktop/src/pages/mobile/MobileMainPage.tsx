// ============================================================
// 移动端 — 主页面（设备列表 + 历史记录 + 文件接收确认）
// ============================================================

import { useEffect, useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useAuthStore } from "../../stores/authStore";
import { useDeviceStore } from "../../stores/deviceStore";
import { useTransferHistoryStore } from "../../stores/transferHistoryStore";
import { wsService } from "../../services/websocket";
import { webrtcService } from "../../services/webrtc";
import { fileTransferService } from "../../services/fileTransfer";
import { fetchDevices, logout as apiLogout, removeDevice as apiRemoveDevice } from "../../services/api";
import type { DeviceInfo, TransferProgress } from "../../../../shared/types/index";

// 左划删除组件
function SwipeableCard({ children, onDelete }: { children: React.ReactNode; onDelete: () => void }) {
  const [swiped, setSwiped] = useState(false);
  const startX = useRef(0);

  const onTouchStart = (e: React.TouchEvent) => { startX.current = e.touches[0].clientX; };
  const onTouchEnd = (e: React.TouchEvent) => {
    const diff = startX.current - e.changedTouches[0].clientX;
    if (diff > 60) setSwiped(true);
    else if (diff < -30) setSwiped(false);
  };

  return (
    <div style={{ position: "relative", overflow: "hidden", borderRadius: 16, marginBottom: 10 }}
      onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
      <div style={{ transform: `translateX(${swiped ? -80 : 0}px)`, transition: "transform 0.2s" }}>
        {children}
      </div>
      {swiped && (
        <button onClick={(e) => { e.stopPropagation(); onDelete(); setSwiped(false); }}
          style={{
            position: "absolute", right: 0, top: 0, bottom: 0, width: 80, zIndex: 3,
            background: "#EF4444", border: "none", color: "#fff", fontSize: 14, fontWeight: 700,
            display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer",
          }}>
          删除
        </button>
      )}
      {swiped && (
        <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, zIndex: 2 }}
          onClick={() => setSwiped(false)} />
      )}
    </div>
  );
}

type ReceiveState = {
  phase: "confirm" | "receiving" | "complete" | "saving";
  fileName: string;
  fileSize: number;
  progress: number;
  speedBps: number;
  senderName: string;
};

export function MobileMainPage() {
  const navigate = useNavigate();
  const [tab, setTab] = useState<"devices" | "history">("devices");
  const [receive, setReceive] = useState<ReceiveState | null>(null);
  const pendingBlobRef = useRef<Blob | null>(null);
  const user = useAuthStore((s) => s.user);
  const currentDevice = useAuthStore((s) => s.currentDevice);
  const logout = useAuthStore((s) => s.logout);
  const { myDevices, pairedDevices, setDevices, removePairedDevice, removeDevice } = useDeviceStore();
  const records = useTransferHistoryStore((s) => s.records);

  useEffect(() => {
    loadDevices();
    wsService.connect();

    // 配对成功后自动刷新设备列表
    wsService.setDeviceChangeCallback(() => loadDevices());

    // 接收处理（事件总线，不会被覆盖）
    const onEvent = (ev: import("../../services/webrtc").WebRTCEvent) => {
      if (ev.type === "datachannel_open") {
        const { deviceId: devId, dc } = ev;
        console.log(`📥 Mobile DataChannel from ${devId.slice(0, 8)}`);
        setReceive({
          phase: "confirm", fileName: "", fileSize: 0, progress: 0, speedBps: 0,
          senderName: getDeviceName(devId),
        });
        fileTransferService.setReceiveCallbacks(dc, {
          onProgress: (p: TransferProgress) => {
            setReceive((prev) => {
              if (!prev || prev.phase === "saving") return prev;
              return { ...prev, fileName: p.file_name, fileSize: p.total_bytes, progress: p.percentage, speedBps: p.speed_bps || 0, phase: prev.phase === "confirm" ? "receiving" : prev.phase };
            });
          },
          onComplete: (r) => {
            setReceive((prev) => prev ? { ...prev, phase: "complete", progress: 100 } : null);
            useTransferHistoryStore.getState().addRecord({
              id: `${r.file_id}-${Date.now()}`, fileName: r.file_name, fileSize: receive?.fileSize || 0,
              deviceName: receive?.senderName || "未知设备", direction: "received",
              timestamp: new Date().toISOString(), status: r.success ? "success" : "failed",
              sha256Match: r.sha256_match, errorMessage: r.error_message,
            });
          },
          onSaveNeeded: (_fn, blob) => { pendingBlobRef.current = blob; },
          onError: () => setReceive(null),
        });
      } else if (ev.type === "connection_change") {
        if (ev.state === "failed" || ev.state === "disconnected") {
          setReceive((prev) => prev?.phase === "confirm" ? null : prev);
        }
      }
    };
    webrtcService.on(onEvent);

    return () => {
      webrtcService.off(onEvent);
      wsService.setDeviceChangeCallback(null);
    };
  }, []);

  const getDeviceName = (devId: string) => {
    const all = [...useDeviceStore.getState().myDevices, ...useDeviceStore.getState().pairedDevices];
    return all.find((d) => d.id === devId)?.device_name || "未知设备";
  };

  const handleAcceptReceive = () => {
    setReceive((prev) => prev ? { ...prev, phase: "receiving" } : null);
  };

  const handleDeclineReceive = () => {
    pendingBlobRef.current = null;
    setReceive(null);
  };

  const handleSaveFile = () => {
    if (!receive) return;
    const blob = pendingBlobRef.current;
    if (!blob) return;

    setReceive({ ...receive, phase: "saving" });

    const reader = new FileReader();
    reader.onload = () => {
      const base64 = (reader.result as string).split(",")[1];
      if (typeof (window as any).webkit?.messageHandlers?.quickdrop?.postMessage === "function") {
        (window as any).webkit.messageHandlers.quickdrop.postMessage({
          action: "saveReceivedFile",
          fileName: receive.fileName,
          data: base64,
        });
      }
      setReceive((prev) => prev ? { ...prev, phase: "complete" } : null);
    };
    reader.readAsDataURL(blob);
  };

  const loadDevices = async () => {
    try {
      const r = await fetchDevices();
      setDevices(r.my_devices as DeviceInfo[], r.paired_devices as DeviceInfo[]);
    } catch { /* ok */ }
  };

  const handleLogout = async () => {
    try { await apiLogout(false); } catch { /* ok */ }
    wsService.disconnect();
    logout();
  };

  const allDevices = myDevices.filter(d => d.id !== currentDevice?.id);
  const onlineDevices = allDevices.filter(d => d.is_online);
  const offlineDevices = allDevices.filter(d => !d.is_online);

  const fmtSize = (b: number) =>
    b < 1024 ? `${b}B` : b < 1048576 ? `${(b / 1024).toFixed(1)}KB` : `${(b / 1048576).toFixed(1)}MB`;
  const fmtSpeed = (bps: number) =>
    bps < 1024 ? `${bps} B/s` : bps < 1048576 ? `${(bps / 1024).toFixed(1)} KB/s` : `${(bps / 1048576).toFixed(1)} MB/s`;

  const fmtTime = (iso: string) => {
    try { const d = new Date(iso); return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; }
    catch { return iso; }
  };

  const deviceIcon = (d: DeviceInfo) => d.device_type === "phone" ? "📱" : d.device_type === "tablet" ? "📋" : "💻";

  return (
    <div className="mobile-page">
      {/* 顶部 */}
      <div className="mobile-main-header">
        <div>
          <h1>QuickDrop</h1>
          <div className="email">{user?.email}</div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="mobile-main-logout" onClick={() => navigate("/pair")}
            style={{ background: "#4F46E5", color: "#fff" }}>
            ＋ 配对
          </button>
          <button className="mobile-main-logout" onClick={handleLogout}>退出</button>
        </div>
      </div>

      {/* ====== 文件接收弹窗 / 进度 / 保存 ====== */}
      {receive && (
        <div style={{
          position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
          background: "rgba(0,0,0,0.5)", zIndex: 1000,
          display: "flex", alignItems: "center", justifyContent: "center",
          padding: 20,
        }}>
          <div style={{
            background: "#fff", borderRadius: 20, padding: 28,
            width: "100%", maxWidth: 340, textAlign: "center",
            boxShadow: "0 20px 60px rgba(0,0,0,0.3)",
          }}>
            {/* 确认阶段 */}
            {receive.phase === "confirm" && (
              <>
                <div style={{ fontSize: 56, marginBottom: 12 }}>📥</div>
                <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 8, color: "#1F2937" }}>
                  收到文件传输请求
                </div>
                <div style={{ fontSize: 14, color: "#6B7280", marginBottom: 4 }}>
                  来自：{receive.senderName}
                </div>
                <div style={{ fontSize: 13, color: "#9CA3AF", marginBottom: 24 }}>
                  文件信息将在接收时显示
                </div>
                <div style={{ display: "flex", gap: 12 }}>
                  <button
                    onClick={handleDeclineReceive}
                    style={{
                      flex: 1, padding: 14, background: "#F3F4F6", border: "none",
                      borderRadius: 14, fontSize: 15, fontWeight: 600, color: "#6B7280",
                    }}>
                    拒绝
                  </button>
                  <button
                    onClick={handleAcceptReceive}
                    style={{
                      flex: 1, padding: 14, background: "#4F46E5", border: "none",
                      borderRadius: 14, fontSize: 15, fontWeight: 700, color: "#fff",
                    }}>
                    接受
                  </button>
                </div>
              </>
            )}

            {/* 接收中 */}
            {receive.phase === "receiving" && (
              <>
                <div style={{ fontSize: 40, marginBottom: 12 }}>📤</div>
                <div style={{ fontSize: 16, fontWeight: 600, color: "#1F2937", marginBottom: 8 }}>
                  {receive.fileName || "接收中..."}
                </div>
                <div style={{ height: 8, background: "#E5E7EB", borderRadius: 4, overflow: "hidden", marginBottom: 12 }}>
                  <div style={{
                    height: "100%", width: `${receive.progress}%`,
                    background: "linear-gradient(90deg, #4F46E5, #818CF8)",
                    borderRadius: 4, transition: "width 0.2s",
                  }} />
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: "#6B7280", marginBottom: 16 }}>
                  <span>{receive.progress}%</span>
                  <span>{receive.fileSize > 0 ? fmtSize(receive.fileSize) : ""}</span>
                  <span>{receive.speedBps > 0 ? fmtSpeed(receive.speedBps) : ""}</span>
                </div>
                <div style={{ fontSize: 13, color: "#9CA3AF" }}>
                  来自：{receive.senderName}
                </div>
              </>
            )}

            {/* 完成 */}
            {receive.phase === "complete" && (
              <>
                <div style={{ fontSize: 56, marginBottom: 12 }}>✅</div>
                <div style={{ fontSize: 18, fontWeight: 700, color: "#065F46", marginBottom: 4 }}>
                  接收完成
                </div>
                <div style={{ fontSize: 14, color: "#6B7280", marginBottom: 4 }}>
                  {receive.fileName}
                </div>
                {receive.fileSize > 0 && (
                  <div style={{ fontSize: 13, color: "#9CA3AF", marginBottom: 20 }}>
                    {fmtSize(receive.fileSize)}
                  </div>
                )}
                <div style={{ display: "flex", gap: 12 }}>
                  <button
                    onClick={() => setReceive(null)}
                    style={{
                      flex: 1, padding: 14, background: "#F3F4F6", border: "none",
                      borderRadius: 14, fontSize: 15, fontWeight: 600, color: "#6B7280",
                    }}>
                    关闭
                  </button>
                  <button
                    onClick={handleSaveFile}
                    style={{
                      flex: 1, padding: 14, background: "#10B981", border: "none",
                      borderRadius: 14, fontSize: 15, fontWeight: 700, color: "#fff",
                    }}>
                    💾 保存文件
                  </button>
                </div>
              </>
            )}

            {/* 保存中 */}
            {receive.phase === "saving" && (
              <>
                <div style={{ fontSize: 40, marginBottom: 12 }}>💾</div>
                <div style={{ fontSize: 16, fontWeight: 600, color: "#1F2937" }}>
                  正在保存...
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* 标签栏 */}
      <div className="mobile-main-tabs">
        <button className={`mobile-main-tab ${tab === "devices" ? "active" : ""}`} onClick={() => setTab("devices")}>
          💻 设备
        </button>
        <button className={`mobile-main-tab ${tab === "history" ? "active" : ""}`} onClick={() => setTab("history")}>
          📋 历史
        </button>
      </div>

      {/* 内容 */}
      <div className="mobile-main-content">
        {tab === "devices" && (
          <>
            {currentDevice && (
              <div className="mobile-self-card">
                <div className="mobile-self-icon">{deviceIcon(currentDevice)}</div>
                <div className="mobile-self-info">
                  <div className="mobile-self-name">{currentDevice.device_name}（本机）</div>
                  <div className="mobile-self-meta">{currentDevice.os} · 当前设备</div>
                </div>
                <span className="mobile-status online">在线</span>
              </div>
            )}

            {onlineDevices.length > 0 && (
              <>
                <div className="mobile-section-title">在线设备 · {onlineDevices.length}</div>
                <div className="mobile-device-list">
                  {onlineDevices.map(d => (
                    <SwipeableCard key={d.id} onDelete={() => { apiRemoveDevice(d.id).catch(()=>{}); removeDevice(d.id); removePairedDevice(d.id); }}>
                      <div className="mobile-device-card" onClick={() => navigate(`/transfer/${d.id}`)}>
                        <div className={`mobile-device-card-icon ${d.device_type}`}>{deviceIcon(d)}</div>
                        <div className="mobile-device-info">
                          <div className="mobile-device-name">{d.device_name}</div>
                          <div className="mobile-device-meta">{d.os}</div>
                        </div>
                        <span className="mobile-status online">在线</span>
                      </div>
                    </SwipeableCard>
                  ))}
                </div>
              </>
            )}

            {offlineDevices.length > 0 && (
              <>
                <div className="mobile-section-title" style={{ marginTop: 20 }}>离线设备 · {offlineDevices.length}</div>
                <div className="mobile-device-list">
                  {offlineDevices.map(d => (
                    <SwipeableCard key={d.id} onDelete={() => { apiRemoveDevice(d.id).catch(()=>{}); removeDevice(d.id); removePairedDevice(d.id); }}>
                      <div className="mobile-device-card offline">
                        <div className={`mobile-device-card-icon ${d.device_type}`} style={{ opacity: 0.5 }}>{deviceIcon(d)}</div>
                        <div className="mobile-device-info">
                          <div className="mobile-device-name">{d.device_name}</div>
                          <div className="mobile-device-meta">{d.os}</div>
                        </div>
                        <span className="mobile-status offline">离线</span>
                      </div>
                    </SwipeableCard>
                  ))}
                </div>
              </>
            )}

            {/* 配对设备（左划删除） */}
            {pairedDevices.length > 0 && (
              <>
                <div className="mobile-section-title" style={{ marginTop: 20 }}>配对设备 · {pairedDevices.length}</div>
                <div className="mobile-device-list">
                  {pairedDevices.map(d => (
                    <SwipeableCard key={d.id} onDelete={() => { apiRemoveDevice(d.id).catch(()=>{}); removeDevice(d.id); removePairedDevice(d.id); }}>
                      <div className="mobile-device-card" onClick={() => d.is_online && navigate(`/transfer/${d.id}`)}>
                        <div className={`mobile-device-card-icon ${d.device_type}`}>{deviceIcon(d)}</div>
                        <div className="mobile-device-info">
                          <div className="mobile-device-name">{d.device_name}</div>
                          <div className="mobile-device-meta">{d.os}</div>
                        </div>
                        <span className={`mobile-status ${d.is_online ? "online" : "offline"}`}>{d.is_online ? "在线" : "离线"}</span>
                      </div>
                    </SwipeableCard>
                  ))}
                </div>
              </>
            )}

            {allDevices.length === 0 && pairedDevices.length === 0 && (
              <div className="mobile-empty">
                <div className="mobile-empty-icon">📱</div>
                <h3>暂无其他设备</h3>
                <p>在其他设备上登录同一账号<br />即可自动配对并传输文件</p>
              </div>
            )}
          </>
        )}

        {tab === "history" && (
          <>
            {records.length === 0 ? (
              <div className="mobile-empty">
                <div className="mobile-empty-icon">📋</div>
                <h3>暂无传输记录</h3>
                <p>选择在线设备并发送文件<br />传输记录将显示在这里</p>
              </div>
            ) : (
              <div className="mobile-history-list">
                {records.map(r => (
                  <div key={r.id} className="mobile-history-item">
                    <div className={`mobile-history-icon ${r.direction}`}>
                      {r.direction === "sent" ? "📤" : "📥"}
                    </div>
                    <div className="mobile-history-info">
                      <div className="mobile-history-filename">{r.fileName}</div>
                      <div className="mobile-history-detail">
                        {r.deviceName} · {fmtSize(r.fileSize)} · {fmtTime(r.timestamp)}
                      </div>
                    </div>
                    <span className={`mobile-history-badge ${r.status}`}>
                      {r.status === "success" ? "成功" : "失败"}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
