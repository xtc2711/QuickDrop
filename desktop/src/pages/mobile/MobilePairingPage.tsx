// ============================================================
// 移动端 — 设备配对页面（扫码加入 / 输入配对码 / 我的配对码）
// ============================================================

import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuthStore } from "../../stores/authStore";
import { wsService } from "../../services/websocket";

function getOS(): "ios" | "android" {
  return /iPhone|iPad/i.test(navigator.userAgent) ? "ios" : "android";
}

export function MobilePairingPage() {
  const navigate = useNavigate();
  const currentDevice = useAuthStore((s) => s.currentDevice);

  const [tab, setTab] = useState<"scan" | "code" | "mycode">("scan");
  const [pairCode, setPairCode] = useState("");
  const [myCode, setMyCode] = useState<{ code: string; expiresAt: number } | null>(null);
  const [joining, setJoining] = useState(false);
  const [status, setStatus] = useState<{ type: "success" | "error"; msg: string } | null>(null);
  const [scanHint, setScanHint] = useState("将二维码对准扫描框");

  // 扫码结果监听
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as { qrData: string };
      if (detail?.qrData) {
        setScanHint("扫码成功！正在加入配对...");
        joinByScan(detail.qrData);
      }
    };
    window.addEventListener("quickdrop:qrScanned", handler);
    return () => window.removeEventListener("quickdrop:qrScanned", handler);
  }, []);

  // 配对成功/失败监听
  useEffect(() => {
    wsService.setPairingCallback((msg) => {
      if (msg.type === "pairing_success") {
        setStatus({ type: "success", msg: "配对成功！" });
        setJoining(false);
        setTimeout(() => navigate("/devices"), 800);
      } else if (msg.type === "pairing_failed") {
        setStatus({ type: "error", msg: (msg.payload as any)?.message || "配对失败" });
        setJoining(false);
      } else if (msg.type === "pairing_code_created") {
        const payload = msg.payload as { code: string; expires_in: number };
        setMyCode({ code: payload.code, expiresAt: Date.now() + payload.expires_in * 1000 });
      }
    });
    return () => wsService.setPairingCallback(null);
  }, [navigate]);

  // 扫码加入
  const joinByScan = (qrData: string) => {
    setJoining(true);
    try {
      let roomId: string;
      if (qrData.includes("quickdrop_pairing")) {
        const params = new URLSearchParams(qrData.split("?")[1] || "");
        roomId = params.get("room_id") || qrData;
      } else {
        roomId = qrData;
      }
      wsService.send("join_pairing", {
        room_id: roomId,
        device_name: currentDevice?.device_name || "Mobile",
        device_type: "phone",
        os: getOS(),
      });
    } catch {
      setStatus({ type: "error", msg: "无效的二维码" });
      setJoining(false);
    }
  };

  // 打开扫码
  const handleScan = () => {
    setScanHint("正在打开相机...");
    setStatus(null);
    if (typeof (window as any).QuickDropNative?.startQRScanner === "function") {
      (window as any).QuickDropNative.startQRScanner();
    } else {
      setStatus({ type: "error", msg: "扫码功能仅在 QuickDrop App 内可用" });
    }
  };

  // 输入码加入
  const handleJoinByCode = () => {
    if (pairCode.length < 6) return;
    setJoining(true);
    setStatus(null);
    wsService.send("join_pairing", {
      code: pairCode,
      device_name: currentDevice?.device_name || "Mobile",
      device_type: "phone",
      os: getOS(),
    });
  };

  // 生成我的码
  const handleCreateCode = () => {
    setStatus(null);
    wsService.send("create_pairing_code", {});
  };

  // 倒计时
  useEffect(() => {
    if (!myCode) return;
    const timer = setInterval(() => {
      if (Date.now() >= myCode.expiresAt) {
        setMyCode(null);
        setStatus({ type: "error", msg: "配对码已过期，请重新生成" });
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [myCode]);

  const fmtRemaining = (expiresAt: number) => {
    const s = Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  };

  return (
    <div className="mobile-page">
      <div className="mobile-main-header">
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button className="mobile-back-btn" onClick={() => navigate("/devices")} style={{ padding: "8px 14px", fontSize: 13 }}>
            ← 返回
          </button>
          <h1 style={{ fontSize: 17, margin: 0 }}>配对新设备</h1>
        </div>
      </div>

      {/* Tab 切换 */}
      <div className="mobile-main-tabs">
        <button className={`mobile-main-tab ${tab === "scan" ? "active" : ""}`} onClick={() => setTab("scan")}>
          📷 扫码
        </button>
        <button className={`mobile-main-tab ${tab === "code" ? "active" : ""}`} onClick={() => setTab("code")}>
          🔢 输入码
        </button>
        <button className={`mobile-main-tab ${tab === "mycode" ? "active" : ""}`} onClick={() => setTab("mycode")}>
          📱 我的码
        </button>
      </div>

      <div className="mobile-main-content" style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
        {/* 状态提示 */}
        {status && (
          <div style={{
            width: "100%", maxWidth: 360, padding: "12px 16px", borderRadius: 12, marginBottom: 20,
            background: status.type === "success" ? "#D1FAE5" : "#FEE2E2",
            color: status.type === "success" ? "#065F46" : "#991B1B",
            fontSize: 14, fontWeight: 600, textAlign: "center",
          }}>
            {status.type === "success" ? "✅ " : "❌ "}{status.msg}
          </div>
        )}

        {/* 扫码 Tab */}
        {tab === "scan" && (
          <div style={{ textAlign: "center", paddingTop: 20, maxWidth: 320 }}>
            <div style={{
              width: 200, height: 200, margin: "0 auto 20px",
              background: "#F3F4F6", borderRadius: 20,
              display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
              border: "3px dashed #D1D5DB",
            }}>
              <div style={{ fontSize: 48, marginBottom: 8 }}>📷</div>
              <div style={{ fontSize: 13, color: "#6B7280" }}>{scanHint}</div>
            </div>
            <button
              onClick={handleScan}
              disabled={joining}
              style={{
                width: "100%", padding: 14, background: joining ? "#9CA3AF" : "#4F46E5",
                color: "#fff", border: "none", borderRadius: 14, fontSize: 16, fontWeight: 700,
              }}
            >
              {joining ? "配对中..." : "打开相机扫码"}
            </button>
            <p style={{ fontSize: 12, color: "#9CA3AF", marginTop: 12 }}>
              在电脑上打开 QuickDrop 的配对二维码，用手机扫描即可完成配对
            </p>
          </div>
        )}

        {/* 输入码 Tab */}
        {tab === "code" && (
          <div style={{ width: "100%", maxWidth: 320, paddingTop: 30 }}>
            <div style={{ textAlign: "center", marginBottom: 24 }}>
              <div style={{ fontSize: 36, marginBottom: 8 }}>🔢</div>
              <div style={{ fontSize: 15, color: "#6B7280" }}>输入电脑上显示的 6 位配对码</div>
            </div>
            <input
              type="text"
              inputMode="numeric"
              maxLength={6}
              value={pairCode}
              onChange={(e) => setPairCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              placeholder="000000"
              style={{
                width: "100%", padding: "16px", textAlign: "center", fontSize: 32, fontWeight: 800,
                letterSpacing: 12, border: "2px solid #E5E7EB", borderRadius: 16, outline: "none",
                boxSizing: "border-box",
              }}
              autoFocus
            />
            <button
              onClick={handleJoinByCode}
              disabled={pairCode.length < 6 || joining}
              style={{
                width: "100%", marginTop: 20, padding: 14,
                background: pairCode.length === 6 && !joining ? "#4F46E5" : "#D1D5DB",
                color: "#fff", border: "none", borderRadius: 14, fontSize: 16, fontWeight: 700,
              }}
            >
              {joining ? "配对中..." : "加入配对"}
            </button>
          </div>
        )}

        {/* 我的码 Tab */}
        {tab === "mycode" && (
          <div style={{ width: "100%", maxWidth: 320, paddingTop: 30, textAlign: "center" }}>
            <div style={{ fontSize: 36, marginBottom: 16 }}>📱</div>
            <div style={{ fontSize: 14, color: "#6B7280", marginBottom: 20 }}>
              生成配对码，让其他设备输入此码完成配对
            </div>

            {myCode ? (
              <>
                <div style={{
                  fontSize: 48, fontWeight: 900, letterSpacing: 16, color: "#4F46E5",
                  background: "#EEF2FF", borderRadius: 16, padding: "20px", marginBottom: 12,
                  fontFamily: "monospace",
                }}>
                  {myCode.code}
                </div>
                <div style={{
                  fontSize: 13, fontWeight: 600,
                  color: Date.now() > myCode.expiresAt - 30000 ? "#EF4444" : "#6B7280",
                  marginBottom: 20,
                }}>
                  {Date.now() > myCode.expiresAt - 30000 ? "⚠️ " : "⏱ "}
                  剩余 {fmtRemaining(myCode.expiresAt)}
                </div>
                <button
                  onClick={handleCreateCode}
                  style={{
                    padding: "10px 24px", background: "#F3F4F6", border: "none",
                    borderRadius: 12, fontSize: 14, fontWeight: 600, color: "#4B5563",
                  }}
                >
                  刷新配对码
                </button>
              </>
            ) : (
              <button
                onClick={handleCreateCode}
                style={{
                  width: "100%", padding: 14, background: "#4F46E5", color: "#fff",
                  border: "none", borderRadius: 14, fontSize: 16, fontWeight: 700,
                }}
              >
                生成配对码
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
