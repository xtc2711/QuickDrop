// ============================================================
// 桌面端 — 文件接收确认弹窗（纯 UI，接收回调由 AppLayout 管理）
// ============================================================

import { useState, useEffect } from "react";
import { useDeviceStore } from "../stores/deviceStore";
import type { TransferProgress } from "../../../shared/types/index";

type Phase = "confirm" | "receiving" | "complete";

interface Props {
  deviceId: string;
  progress: TransferProgress | null;
  onAccept: () => void;
  onDecline: () => void;
  onClose: () => void;
}

export function ReceiveDialog({ deviceId, progress: p, onAccept, onDecline, onClose }: Props) {
  const [phase, setPhase] = useState<Phase>("confirm");
  const [senderName, setSenderName] = useState("");

  useEffect(() => {
    const all = [...useDeviceStore.getState().myDevices, ...useDeviceStore.getState().pairedDevices];
    setSenderName(all.find(d => d.id === deviceId)?.device_name || "未知设备");
  }, [deviceId]);

  // 收到进度数据 → 自动进入接收中
  useEffect(() => {
    if (p && p.status !== "pending" && phase === "confirm") {
      // 数据已在后台接收中，但 UI 仍显示确认
    }
  }, [p]);

  const handleAccept = () => {
    onAccept();
    setPhase("receiving");
  };

  const isDone = p?.status === "completed" || (p?.status === "verifying" && p?.percentage >= 100);
  // 传输完成时直接切到完成状态
  if (isDone && phase !== "complete" && phase !== "confirm") {
    setPhase("complete");
  }

  const fmt = (b: number) => b === 0 ? "..." : b < 1024 ? `${b}B` : b < 1048576 ? `${(b/1024).toFixed(1)}KB` : `${(b/1048576).toFixed(1)}MB`;
  const pc = p?.percentage || 0;

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 10000, display: "flex", alignItems: "center", justifyContent: "center" }}
      onClick={phase === "confirm" ? onDecline : undefined}>
      <div style={{ background: "#fff", borderRadius: 16, padding: 32, width: 420, maxWidth: "90vw", boxShadow: "0 20px 60px rgba(0,0,0,0.2)", textAlign: "center" }}
        onClick={e => e.stopPropagation()}>
        {phase === "confirm" && (
          <>
            <div style={{ fontSize: 48, marginBottom: 16 }}>📥</div>
            <h2 style={{ margin: "0 0 8px", fontSize: 20, color: "#1F2937" }}>收到文件传输请求</h2>
            <div style={{ fontSize: 14, color: "#6B7280", marginBottom: 8 }}><strong>{senderName}</strong> 想要发送文件给你</div>
            {p && p.file_name && <div style={{ fontSize: 13, color: "#9CA3AF", marginBottom: 16 }}>{p.file_name} · {fmt(p.total_bytes)}</div>}
            <div style={{ display: "flex", gap: 12 }}>
              <button onClick={() => { onDecline(); onClose(); }} style={{ flex: 1, padding: 12, background: "#F3F4F6", border: "none", borderRadius: 12, fontSize: 14, fontWeight: 600, color: "#6B7280", cursor: "pointer" }}>拒绝</button>
              <button onClick={handleAccept} style={{ flex: 1, padding: 12, background: "#4F46E5", border: "none", borderRadius: 12, fontSize: 14, fontWeight: 700, color: "#fff", cursor: "pointer" }}>接受</button>
            </div>
          </>
        )}
        {phase === "receiving" && (
          <>
            <div style={{ fontSize: 36, marginBottom: 12 }}>📤</div>
            <h2 style={{ margin: "0 0 4px", fontSize: 18, color: "#1F2937" }}>{p?.file_name || "等待文件数据..."}</h2>
            <div style={{ fontSize: 13, color: "#6B7280", marginBottom: 16 }}>来自：{senderName} · {p && p.total_bytes > 0 ? fmt(p.total_bytes) : "..."}</div>
            {(p && p.status !== "pending") ? (
              <>
                <div style={{ height: 10, background: "#E5E7EB", borderRadius: 5, overflow: "hidden", marginBottom: 8 }}>
                  <div style={{ height: "100%", width: `${pc}%`, background: "linear-gradient(90deg, #4F46E5, #818CF8)", borderRadius: 5 }} />
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: "#6B7280", marginBottom: 20 }}>
                  <span>{pc}%</span>
                  <span>{p.speed_bps > 0 ? `${(p.speed_bps / 1024).toFixed(1)} KB/s` : ""}</span>
                </div>
              </>
            ) : (
              <div style={{ marginBottom: 20, color: "#9CA3AF", fontSize: 13 }}>正在等待发送方传输数据...</div>
            )}
            <button onClick={onClose} style={{ width: "100%", padding: 12, background: "#EF4444", border: "none", borderRadius: 12, fontSize: 14, fontWeight: 700, color: "#fff", cursor: "pointer" }}>取消接收</button>
          </>
        )}
        {phase === "complete" && (
          <>
            <div style={{ fontSize: 48, marginBottom: 12 }}>✅</div>
            <h2 style={{ margin: "0 0 8px", fontSize: 18, color: "#065F46" }}>接收完成</h2>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>{p?.file_name}</div>
            <div style={{ fontSize: 13, color: "#6B7280", marginBottom: 24 }}>{p ? fmt(p.total_bytes) : ""} · 来自 {senderName} · 已保存到下载目录</div>
            <button onClick={onClose} style={{ width: "100%", padding: 12, background: "#4F46E5", border: "none", borderRadius: 12, fontSize: 14, fontWeight: 700, color: "#fff", cursor: "pointer" }}>关闭</button>
          </>
        )}
      </div>
    </div>
  );
}
