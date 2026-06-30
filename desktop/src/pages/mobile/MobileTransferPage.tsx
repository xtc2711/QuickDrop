// ============================================================
// 移动端 — 文件传输页面（发送列表 + 进度条）
// ============================================================

import { useState, useEffect, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { webrtcService } from "../../services/webrtc";
import { wsService } from "../../services/websocket";
import { fileTransferService } from "../../services/fileTransfer";
import type { TransferCallbacks } from "../../services/fileTransfer";
import { useTransferHistoryStore } from "../../stores/transferHistoryStore";
import { useDeviceStore } from "../../stores/deviceStore";
import type { ConnectionChannel } from "../../../../shared/types/index";

type SendEntry = {
  id: string;
  name: string;
  size: number;
  status: "waiting" | "connecting" | "transferring" | "verifying" | "completed" | "failed";
  progress: number;
  speedBps: number;
};

export function MobileTransferPage() {
  const { deviceId } = useParams<{ deviceId: string }>();
  const navigate = useNavigate();

  const [entries, setEntries] = useState<SendEntry[]>([]);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [channelInfo, setChannelInfo] = useState<{ channel: ConnectionChannel; rttMs?: number } | null>(null);
  const transferDoneRef = useRef(false);
  const activeFileRef = useRef<globalThis.File | null>(null);

  const targetDevice = (() => {
    if (!deviceId) return null;
    const { myDevices, pairedDevices } = useDeviceStore.getState();
    return [...myDevices, ...pairedDevices].find(d => d.id === deviceId);
  })();

  // ---- 接收处理 ----
  useEffect(() => {
    webrtcService.setDataChannelReadyHandler((_devId, dc) => {
      fileTransferService.setReceiveCallbacks(dc, {
        onProgress: (p) => {
          setEntries((prev) => {
            const exist = prev.find(e => e.name === p.file_name);
            if (exist) return prev.map(e => e.name === p.file_name ? { ...e, status: p.status as any, progress: p.percentage, speedBps: p.speed_bps || 0 } : e);
            return [...prev, { id: Date.now().toString(), name: p.file_name, size: p.total_bytes, status: "transferring", progress: p.percentage, speedBps: p.speed_bps || 0 }];
          });
          transferDoneRef.current = false;
        },
        onComplete: (r) => {
          transferDoneRef.current = true;
          setEntries((prev) => prev.map(e => e.name === r.file_name ? { ...e, status: r.success ? "completed" : "failed", progress: 100 } : e));
          useTransferHistoryStore.getState().addRecord({
            id: `${r.file_id}-${Date.now()}`, fileName: r.file_name, fileSize: 0,
            deviceName: targetDevice?.device_name || "未知", direction: "received",
            timestamp: new Date().toISOString(), status: r.success ? "success" : "failed",
            sha256Match: r.sha256_match, errorMessage: r.error_message,
          });
        },
        onError: () => { transferDoneRef.current = true; },
      });
    });

    webrtcService.setChannelChangeHandler((_devId, ch) => {
      if (_devId === deviceId) setChannelInfo({ channel: ch, rttMs: webrtcService.getPeerState(deviceId!)?.rttMs });
    });

    webrtcService.setConnectionChangeHandler((_devId, state) => {
      if (state === "failed" && !transferDoneRef.current) { setError("连接失败"); }
      if (state === "disconnected" && !transferDoneRef.current) { setError("设备连接已断开"); }
      if (state === "connected") setConnecting(false);
    });

    return () => {
      webrtcService.setDataChannelReadyHandler(null as any);
      webrtcService.setConnectionChangeHandler(null as any);
      webrtcService.setChannelChangeHandler(null as any);
    };
  }, [deviceId]);

  // ---- 选择并发送 ----
  const handlePickAndSend = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.onchange = () => {
      if (!input.files?.length) return;
      const f = input.files[0];
      const entryId = Date.now().toString();
      activeFileRef.current = f;
      transferDoneRef.current = false;
      setError(null);

      setEntries((prev) => [...prev, { id: entryId, name: f.name, size: f.size, status: "waiting" as const, progress: 0, speedBps: 0 }]);

      // 开始发送
      setConnecting(true);

      webrtcService.setDataChannelReadyHandler((_devId, dc) => {
        setConnecting(false);
        setEntries((prev) => prev.map(e => e.id === entryId ? { ...e, status: "connecting" } : e));

        // 监听接收方确认消息
        const acceptHandler = (ev: MessageEvent) => {
          try {
            const msg = JSON.parse(ev.data);
            if (msg.type === "accept") {
              setEntries((prev) => prev.map(e => e.id === entryId ? { ...e, status: "completed" } : e));
              dc.removeEventListener("message", acceptHandler);
            }
          } catch {}
        };
        dc.addEventListener("message", acceptHandler);

        fileTransferService.setReceiveCallbacks(dc, {
          onProgress: () => {}, onComplete: () => {}, onError: () => {},
        });

        const callbacks: TransferCallbacks = {
          onProgress: (p) => {
            setEntries((prev) => prev.map(e => e.id === entryId ? { ...e, status: p.status as any, progress: p.percentage, speedBps: p.speed_bps || 0 } : e));
          },
          onComplete: (r) => {
            transferDoneRef.current = true;
            setEntries((prev) => prev.map(e => e.id === entryId ? { ...e, status: r.success ? "已送达" as any : "failed", progress: 100 } : e));
            useTransferHistoryStore.getState().addRecord({
              id: `${r.file_id}-${Date.now()}`, fileName: r.file_name, fileSize: f.size,
              deviceName: targetDevice?.device_name || "未知", direction: "sent",
              timestamp: new Date().toISOString(), status: r.success ? "success" : "failed",
              sha256Match: r.sha256_match, errorMessage: r.error_message,
              filePath: (f as any)?.path || undefined,
            } as any);
          },
          onError: (_fid, err) => {
            setError(`发送失败: ${err}`);
            setEntries((prev) => prev.map(e => e.id === entryId ? { ...e, status: "failed" } : e));
          },
        };
        fileTransferService.sendFile(_devId, f, dc, callbacks);
      });

      webrtcService.createOffer(deviceId!, (msg) => wsService.send(msg.type, msg.payload, msg.target))
        .catch(() => { setError("创建 P2P 连接失败"); setConnecting(false); });
    };
    input.click();
  };

  // ---- 格式化 ----
  const fmt = (b: number) => b < 1024 ? `${b}B` : b < 1048576 ? `${(b/1024).toFixed(1)}KB` : `${(b/1048576).toFixed(1)}MB`;
  const fmtSpeed = (bps: number) => bps < 1024 ? `${bps}B/s` : bps < 1048576 ? `${(bps/1024).toFixed(1)}KB/s` : `${(bps/1048576).toFixed(1)}MB/s`;

  const statusLabel: Record<string, string> = { waiting: "等待连接", connecting: "连接中", transferring: "传输中", verifying: "校验中", "已送达": "已送达", completed: "已完成", failed: "失败" };
  const statusColor: Record<string, string> = { waiting: "#6B7280", connecting: "#3B82F6", transferring: "#4F46E5", verifying: "#F59E0B", "已送达": "#F59E0B", completed: "#10B981", failed: "#EF4444" };

  const activeEntry = entries.find(e => e.status === "transferring" || e.status === "verifying" || e.status === "connecting");

  return (
    <div className="mobile-page">
      <div className="mobile-main-header">
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button className="mobile-back-btn" onClick={() => navigate("/devices")} style={{ padding: "8px 14px", fontSize: 13 }}>← 返回</button>
          <div>
            <h1 style={{ fontSize: 17, margin: 0 }}>{targetDevice?.device_name || "设备"}</h1>
            {channelInfo && <div style={{ fontSize: 11, color: "#6B7280" }}>{channelInfo.channel === "lan_p2p" ? "局域网" : "中继"}{channelInfo.rttMs !== undefined ? ` · ${channelInfo.rttMs}ms` : ""}</div>}
          </div>
        </div>
      </div>

      <div className="mobile-main-content" style={{ display: "flex", flexDirection: "column", padding: "0 16px 16px" }}>
        {/* 连接状态 */}
        {connecting && (
          <div style={{ textAlign: "center", padding: "30px 0" }}>
            <div style={{ fontSize: 40, marginBottom: 8 }}>🔗</div>
            <div style={{ fontSize: 15, fontWeight: 600, color: "#4F46E5" }}>正在建立 P2P 加密直连...</div>
          </div>
        )}
        {error && (
          <div style={{ background: "#FEE2E2", color: "#991B1B", padding: "10px 14px", borderRadius: 10, marginBottom: 12, fontSize: 13 }}>❌ {error}</div>
        )}

        {/* 发送文件按钮 */}
        <button onClick={handlePickAndSend} disabled={connecting || !!activeEntry} style={{
          marginTop: 16, padding: 14, background: (connecting || activeEntry) ? "#D1D5DB" : "#4F46E5",
          color: "#fff", border: "none", borderRadius: 14, fontSize: 16, fontWeight: 700, width: "100%",
        }}>
          📁 选择文件并发送
        </button>
        <div style={{ fontSize: 12, color: "#9CA3AF", textAlign: "center", marginTop: 8 }}>
          发送至 {targetDevice?.device_name}
        </div>

        {/* 传输列表 */}
        {entries.length > 0 && (
          <div style={{ marginTop: 24 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: "#374151", marginBottom: 10 }}>传输列表</div>
            {entries.map((e) => (
              <div key={e.id} style={{
                background: "#fff", borderRadius: 12, padding: 14, marginBottom: 8,
                boxShadow: "0 1px 3px rgba(0,0,0,0.06)", display: "flex", alignItems: "center", gap: 12,
              }}>
                <span style={{ fontSize: 22 }}>{e.status === "completed" ? "✅" : e.status === "failed" ? "❌" : "📄"}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.name}</div>
                  <div style={{ fontSize: 12, color: "#6B7280" }}>{fmt(e.size)}</div>
                </div>
                <span style={{ fontSize: 12, fontWeight: 600, color: statusColor[e.status], background: `${statusColor[e.status]}15`, padding: "4px 10px", borderRadius: 10, whiteSpace: "nowrap" }}>
                  {statusLabel[e.status]}{e.status === "transferring" ? ` ${e.progress}%` : ""}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* 底部进度条（传输中显示） */}
        {activeEntry && (
          <div style={{
            position: "fixed", bottom: 0, left: 0, right: 0,
            background: "#fff", borderTop: "1px solid #E5E7EB",
            padding: "12px 20px", paddingBottom: "max(12px, env(safe-area-inset-bottom))",
            zIndex: 100, boxShadow: "0 -2px 10px rgba(0,0,0,0.05)",
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6, fontSize: 13, fontWeight: 600 }}>
              <span>{activeEntry.name}</span>
              <span style={{ color: statusColor[activeEntry.status] }}>{activeEntry.progress}%</span>
            </div>
            <div style={{ height: 6, background: "#E5E7EB", borderRadius: 3, overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${activeEntry.progress}%`, background: "linear-gradient(90deg, #4F46E5, #818CF8)", borderRadius: 3, transition: "width 0.2s" }} />
            </div>
            <div style={{ fontSize: 11, color: "#9CA3AF", marginTop: 4 }}>
              {activeEntry.speedBps > 0 ? fmtSpeed(activeEntry.speedBps) : ""}
              {" · "}{statusLabel[activeEntry.status]}
            </div>
          </div>
        )}

        {/* 空状态 */}
        {entries.length === 0 && !connecting && (
          <div style={{ textAlign: "center", padding: "40px 0", color: "#9CA3AF" }}>
            <div style={{ fontSize: 48, marginBottom: 12 }}>📤</div>
            <div style={{ fontSize: 15 }}>选择文件发送至 {targetDevice?.device_name}</div>
          </div>
        )}
      </div>
    </div>
  );
}
