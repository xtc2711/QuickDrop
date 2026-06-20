// ============================================================
// 桌面客户端 — 登录页面
// ============================================================

import { useState, FormEvent } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useAuthStore } from "../stores/authStore";
import { wsService } from "../services/websocket";
import { login } from "../services/api";

export default function LoginPage() {
  const navigate = useNavigate();
  const setAuth = useAuthStore((s) => s.setAuth);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const result = await login({
        email,
        password,
        device_name: getDeviceName(),
        device_type: "desktop",
        os: getOS(),
        remember_device: remember,
      });

      setAuth(result.user, result.device, result.tokens);

      // 建立 WebSocket 连接
      wsService.connect();

      navigate("/devices");
    } catch (err) {
      setError(err instanceof Error ? err.message : "登录失败");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="page-container">
      <h1 className="page-title">登录 QuickDrop</h1>

      <form onSubmit={handleSubmit} className="card">
        <div className="form-group">
          <label className="form-label" htmlFor="email">
            邮箱
          </label>
          <input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="user@example.com"
            required
            autoFocus
          />
        </div>

        <div className="form-group">
          <label className="form-label" htmlFor="password">
            密码
          </label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="输入密码"
            required
          />
        </div>

        <div className="form-group" style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <input
            id="remember"
            type="checkbox"
            checked={remember}
            onChange={(e) => setRemember(e.target.checked)}
            style={{ width: "auto" }}
          />
          <label htmlFor="remember" style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>
            记住此设备
          </label>
        </div>

        {error && <div className="form-error" style={{ marginBottom: 16 }}>{error}</div>}

        <button type="submit" className="btn-primary" disabled={loading} style={{ width: "100%", padding: 12 }}>
          {loading ? "登录中..." : "登录"}
        </button>

        <p style={{ textAlign: "center", marginTop: 16, fontSize: 13, color: "var(--color-text-secondary)" }}>
          还没有账号？<Link to="/register" style={{ color: "var(--color-primary)" }}>立即注册</Link>
        </p>
      </form>
    </div>
  );
}

function getDeviceName(): string {
  // Tauri 环境下可通过 @tauri-apps/api 获取
  return navigator.platform || "Desktop";
}

function getOS(): "windows" | "macos" | "android" | "ios" {
  const p = navigator.platform.toLowerCase();
  if (p.includes("win")) return "windows";
  if (p.includes("mac")) return "macos";
  return "windows";
}
