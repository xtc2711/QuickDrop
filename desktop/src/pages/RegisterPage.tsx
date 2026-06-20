// ============================================================
// 桌面客户端 — 注册页面
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
    <div className="page-container">
      <h1 className="page-title">注册 QuickDrop</h1>

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
            placeholder="至少 8 位，包含大小写字母和数字"
            required
          />
        </div>

        <div className="form-group">
          <label className="form-label" htmlFor="confirmPassword">
            确认密码
          </label>
          <input
            id="confirmPassword"
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            placeholder="再次输入密码"
            required
          />
        </div>

        {error && <div className="form-error" style={{ marginBottom: 16 }}>{error}</div>}

        <button type="submit" className="btn-primary" disabled={loading} style={{ width: "100%", padding: 12 }}>
          {loading ? "注册中..." : "注册"}
        </button>

        <p style={{ textAlign: "center", marginTop: 16, fontSize: 13, color: "var(--color-text-secondary)" }}>
          已有账号？<Link to="/login" style={{ color: "var(--color-primary)" }}>立即登录</Link>
        </p>
      </form>
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
