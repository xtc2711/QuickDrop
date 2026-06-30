// ============================================================
// 桌面客户端 — 注册页面（桌面端左右分栏布局）
// ============================================================

import { useState, FormEvent } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useAuthStore } from "../stores/authStore";
import { wsService } from "../services/websocket";
import { register } from "../services/api";

export default function RegisterPage() {
  const navigate = useNavigate();
  const setAuth = useAuthStore((s) => s.setAuth);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");

    if (password !== confirmPassword) {
      setError("两次输入的密码不一致");
      return;
    }
    if (password.length < 8) {
      setError("密码至少需要 8 位");
      return;
    }
    if (!/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/[0-9]/.test(password)) {
      setError("密码必须包含大写字母、小写字母和数字");
      return;
    }

    setLoading(true);
    try {
      const result = await register({
        email,
        password,
        device_name: getDeviceName(),
        device_type: "desktop",
        os: getOS(),
      });
      setAuth(result.user, result.device, result.tokens);
      wsService.connect();
      navigate("/devices");
    } catch (err) {
      setError(err instanceof Error ? err.message : "注册失败");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-brand">
        <div className="auth-brand-content">
          <h1>QuickDrop</h1>
          <p>
            加入 QuickDrop，开启跨设备高效文件传输。
            <br />
            注册只需一个邮箱，设备间直连点对点。
          </p>
        </div>
      </div>

      <div className="auth-form-area">
        <div className="auth-form-card">
          <h2>注册</h2>
          <p className="auth-subtitle">创建你的 QuickDrop 账号</p>

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
                placeholder="至少 8 位，包含大小写字母和数字"
                required
              />
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="confirmPassword">确认密码</label>
              <input
                id="confirmPassword"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="再次输入密码"
                required
              />
            </div>

            {error && <div className="alert alert-error">{error}</div>}

            <button type="submit" className="btn-primary" disabled={loading} style={{ width: "100%", padding: 12, marginTop: 8 }}>
              {loading ? "注册中..." : "注册"}
            </button>

            <p style={{ textAlign: "center", marginTop: 20, fontSize: 13, color: "var(--color-text-secondary)" }}>
              已有账号？<Link to="/login" style={{ color: "var(--color-primary)" }}>立即登录</Link>
            </p>
          </form>
        </div>
      </div>
    </div>
  );
}

function getDeviceName(): string {
  return navigator.platform || "Desktop";
}

function getOS(): "windows" | "macos" | "android" | "ios" {
  const p = navigator.platform.toLowerCase();
  if (p.includes("win")) return "windows";
  if (p.includes("mac")) return "macos";
  return "windows";
}
