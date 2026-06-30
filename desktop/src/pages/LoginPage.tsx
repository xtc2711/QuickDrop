// ============================================================
// 桌面客户端 — 登录页面（桌面端左右分栏布局）
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
        device_name: getDeviceName(email),
        device_type: "desktop",
        os: getOS(),
        remember_device: remember,
      });

      setAuth(result.user, result.device, result.tokens);
      wsService.connect();
      navigate("/devices");
    } catch (err) {
      setError(err instanceof Error ? err.message : "登录失败");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-page">
      {/* 左侧品牌区 */}
      <div className="auth-brand">
        <div className="auth-brand-content">
          <h1>QuickDrop</h1>
          <p>
            跨设备文件传输，快速、安全、无需上传云端。
            <br />
            在同一网络下，设备之间直接点对点传输。
          </p>
        </div>
      </div>

      {/* 右侧表单区 */}
      <div className="auth-form-area">
        <div className="auth-form-card">
          <h2>登录</h2>
          <p className="auth-subtitle">欢迎回来，请登录你的账号</p>

          <form onSubmit={handleSubmit}>
            <div className="form-group">
              <label className="form-label" htmlFor="email">邮箱</label>
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
              <label className="form-label" htmlFor="password">密码</label>
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
              <label htmlFor="remember" style={{ fontSize: 13, color: "var(--color-text-secondary)", cursor: "pointer" }}>
                记住此设备
              </label>
            </div>

            {error && <div className="alert alert-error">{error}</div>}

            <button type="submit" className="btn-primary" disabled={loading} style={{ width: "100%", padding: 12, marginTop: 8 }}>
              {loading ? "登录中..." : "登录"}
            </button>

            <p style={{ textAlign: "center", marginTop: 20, fontSize: 13, color: "var(--color-text-secondary)" }}>
              <Link to="/forgot-password" style={{ color: "var(--color-text-secondary)" }}>忘记密码？</Link>
              <span style={{ margin: "0 12px" }}>·</span>
              <Link to="/register" style={{ color: "var(--color-primary)" }}>立即注册</Link>
            </p>
          </form>
        </div>
      </div>
    </div>
  );
}

function getDeviceName(email: string): string {
  const prefix = email.split("@")[0] || "用户";
  const p = navigator.platform || "";
  if (p.includes("Win")) return `${prefix} 的 Windows`;
  if (p.includes("Mac")) return `${prefix} 的 Mac`;
  if (p.includes("Linux")) return `${prefix} 的 Linux`;
  return `${prefix} 的 电脑`;
}

function getOS(): "windows" | "macos" | "android" | "ios" {
  const p = navigator.platform.toLowerCase();
  if (p.includes("win")) return "windows";
  if (p.includes("mac")) return "macos";
  return "windows";
}
