// ============================================================
// 桌面客户端 — 配对弹窗
// 支持二维码配对、配对码展示、配对码输入
// ============================================================

import { useCallback, useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { wsService } from "../services/websocket";
import { useAuthStore } from "../stores/authStore";

type TabMode = "create" | "join";
type Status = "idle" | "loading" | "success" | "error";

interface Props {
  onClose: () => void;
  onPaired: () => void;
}

export default function PairingDialog({ onClose, onPaired }: Props) {
  const [tab, setTab] = useState<TabMode>("create");

  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [pairingCode, setPairingCode] = useState<string | null>(null);
  const [expiresIn, setExpiresIn] = useState(0);
  const [showCode, setShowCode] = useState(false);

  const [inputCode, setInputCode] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState("");

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const device = useAuthStore((s) => s.currentDevice);

  /** 安全发送，连接未就绪时延迟重试 */
  const safeSend = useCallback((type: string, payload: unknown, retries = 3) => {
    if (wsService.send(type, payload)) return;
    // WebSocket 未就绪，延迟重试
    if (retries > 0) {
      console.warn(`[PairingDialog] Retrying ${type} in 500ms (${retries} left)`);
      retryRef.current = setTimeout(() => safeSend(type, payload, retries - 1), 500);
    } else {
      setMessage("WebSocket 连接未就绪，请关闭弹窗后重试");
      setStatus("error");
    }
  }, []);

  /** 处理配对消息 */
  const handlePairingMessage = useCallback((msg: { type: string; payload: any }) => {
    switch (msg.type) {
      case "pairing_qr_created":
        setQrDataUrl(msg.payload.qr_data);
        setExpiresIn(msg.payload.expires_in);
        safeSend("create_pairing_code", {});
        break;

      case "pairing_code_created":
        setPairingCode(msg.payload.code);
        setExpiresIn((prev) => prev || msg.payload.expires_in);
        break;

      case "pairing_success":
        setStatus("success");
        setMessage("配对成功！");
        setTimeout(() => { onPaired(); onClose(); }, 1200);
        break;

      case "pairing_failed":
        setStatus("error");
        setMessage(msg.payload?.message || "配对失败");
        break;
    }
  }, [onClose, onPaired, safeSend]);

  // 注册配对消息回调并请求二维码
  useEffect(() => {
    wsService.setPairingCallback(handlePairingMessage);
    if (tab === "create") {
      safeSend("create_pairing_qr", {});
    }
    return () => {
      wsService.setPairingCallback(null);
      if (timerRef.current) clearInterval(timerRef.current);
      if (retryRef.current) clearTimeout(retryRef.current);
    };
  }, [tab, handlePairingMessage, safeSend]);

  // 倒计时
  useEffect(() => {
    if (expiresIn > 0) {
      timerRef.current = setInterval(() => {
        setExpiresIn((prev) => {
          if (prev <= 1) {
            if (timerRef.current) clearInterval(timerRef.current);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [expiresIn]);

  // 渲染二维码
  useEffect(() => {
    if (qrDataUrl && canvasRef.current) {
      QRCode.toCanvas(canvasRef.current, qrDataUrl, { width: 220, margin: 2 }).catch(console.error);
    }
  }, [qrDataUrl]);

  const handleJoinByCode = () => {
    const code = inputCode.trim();
    if (code.length !== 6 || !/^\d{6}$/.test(code)) {
      setStatus("error");
      setMessage("请输入 6 位数字配对码");
      return;
    }
    setStatus("loading");
    setMessage("正在配对...");
    safeSend("join_pairing", {
      code,
      device_name: device?.device_name,
      device_type: device?.device_type,
      os: device?.os,
    });
  };

  const handleRefreshQr = () => {
    setQrDataUrl(null);
    setPairingCode(null);
    setExpiresIn(0);
    setShowCode(false);
    safeSend("create_pairing_qr", {});
  };

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        style={{
          background: "#fff", borderRadius: 16, width: 400, maxHeight: "90vh",
          overflow: "auto", boxShadow: "0 20px 60px rgba(0,0,0,0.15)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* 标题栏 */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "20px 24px 0" }}>
          <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>配对新设备</h2>
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 20, cursor: "pointer", color: "#999", padding: 4 }}>✕</button>
        </div>

        {/* 模式切换 */}
        <div style={{ display: "flex", margin: "16px 24px 0", background: "#f1f5f9", borderRadius: 8, padding: 4 }}>
          {(["create", "join"] as TabMode[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              style={{
                flex: 1, padding: "8px 0", borderRadius: 6, border: "none", fontSize: 14,
                fontWeight: tab === t ? 600 : 400, cursor: "pointer", transition: "all 0.15s",
                background: tab === t ? "#fff" : "transparent",
                color: tab === t ? "#1a1a1a" : "#64748b",
                boxShadow: tab === t ? "0 1px 3px rgba(0,0,0,0.1)" : "none",
              }}
            >
              {t === "create" ? "允许其他设备配对" : "加入其他设备"}
            </button>
          ))}
        </div>

        <div style={{ padding: "24px" }}>
          {tab === "create" && (
            <>
              <div style={{ textAlign: "center", padding: "20px", background: "#fafafa", borderRadius: 12, marginBottom: 16 }}>
                <p style={{ fontSize: 13, color: "#64748b", marginTop: 0, marginBottom: 16 }}>
                  使用手机 QuickDrop 扫描二维码完成配对
                </p>

                {qrDataUrl ? (
                  <canvas ref={canvasRef} style={{ borderRadius: 8, background: "#fff", padding: 8 }} />
                ) : message && status === "error" ? (
                  <div className="alert alert-error" style={{ fontSize: 13 }}>{message}</div>
                ) : (
                  <div style={{ padding: 40 }}>
                    <p style={{ color: "#999", fontSize: 14 }}>正在生成二维码...</p>
                  </div>
                )}

                {expiresIn > 0 && (
                  <p style={{ fontSize: 12, color: expiresIn < 30 ? "#ef4444" : "#64748b", marginTop: 12, marginBottom: 0 }}>
                    {expiresIn < 30 ? "即将过期 " : "有效 "}{formatTime(expiresIn)}
                  </p>
                )}
                {expiresIn === 0 && qrDataUrl && (
                  <p style={{ fontSize: 12, color: "#ef4444", marginTop: 12, marginBottom: 0 }}>二维码已过期</p>
                )}
              </div>

              {pairingCode ? (
                <div style={{ textAlign: "center", padding: "16px", background: "#f0f9ff", borderRadius: 12, marginBottom: 12 }}>
                  <p style={{ fontSize: 13, color: "#64748b", margin: "0 0 8px" }}>或在另一台设备输入配对码</p>
                  <div style={{ fontSize: 32, fontWeight: 700, letterSpacing: 8, color: "#1e293b", fontFamily: "monospace" }}>
                    {pairingCode}
                  </div>
                </div>
              ) : showCode ? (
                <div style={{ textAlign: "center", padding: 16 }}>
                  <p style={{ color: "#999", fontSize: 14 }}>正在生成配对码...</p>
                </div>
              ) : (
                <button
                  onClick={() => { setShowCode(true); if (!pairingCode) safeSend("create_pairing_code", {}); }}
                  style={{ width: "100%", padding: "10px 0", fontSize: 14, color: "#3b82f6",
                    background: "none", border: "1px dashed #3b82f6", borderRadius: 8, cursor: "pointer", marginBottom: 12 }}
                >使用配对码</button>
              )}

              <button onClick={handleRefreshQr}
                style={{ width: "100%", padding: "10px 0", fontSize: 14, background: "#f1f5f9",
                  border: "none", borderRadius: 8, cursor: "pointer", color: "#475569" }}>
                刷新二维码
              </button>
            </>
          )}

          {tab === "join" && (
            <>
              <p style={{ fontSize: 13, color: "#64748b", marginTop: 0, marginBottom: 16 }}>
                输入另一台设备上显示的 6 位配对码
              </p>

              <div style={{ marginBottom: 16 }}>
                <input
                  type="text" value={inputCode} maxLength={6} autoFocus
                  onChange={(e) => { setInputCode(e.target.value.replace(/\D/g, "").slice(0, 6)); if (status === "error") setStatus("idle"); }}
                  onKeyDown={(e) => { if (e.key === "Enter") handleJoinByCode(); }}
                  placeholder="输入 6 位配对码"
                  style={{
                    width: "100%", padding: "14px 16px", fontSize: 24, fontWeight: 700,
                    textAlign: "center", letterSpacing: 8, fontFamily: "monospace",
                    border: `2px solid ${status === "error" ? "#ef4444" : "#e2e8f0"}`, borderRadius: 12, outline: "none", boxSizing: "border-box",
                  }}
                />
              </div>

              {message && (
                <div className={`alert alert-${status === "success" ? "success" : status === "error" ? "error" : "info"}`}>
                  {status === "loading" && <span style={{ marginRight: 8 }}>⏳</span>}
                  {status === "success" && <span style={{ marginRight: 8 }}>✓</span>}
                  {status === "error" && <span style={{ marginRight: 8 }}>✗</span>}
                  {message}
                </div>
              )}

              <button
                onClick={handleJoinByCode}
                disabled={inputCode.length !== 6 || status === "loading"}
                className="btn-primary"
                style={{
                  width: "100%", padding: "12px 0", fontSize: 16, fontWeight: 600,
                  ...(inputCode.length !== 6 || status === "loading" ? { background: "#a0c4ff", cursor: "not-allowed" } : {}),
                }}
              >{status === "loading" ? "配对中..." : "加入配对"}</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
