import { useState, FormEvent } from "react";
import { useAuthStore } from "../../stores/authStore";
import { wsService } from "../../services/websocket";
import { login } from "../../services/api";
import "./MobilePages.css";

interface Props { onNavigate: (page: string) => void; }

function getDeviceLabel(email: string): string {
  const prefix = email.split("@")[0] || "用户";
  return /iPhone|iPad/i.test(navigator.userAgent) ? `${prefix} 的 iPhone` : `${prefix} 的 手机`;
}

function getOS(): "ios" | "android" {
  return /iPhone|iPad/i.test(navigator.userAgent) ? "ios" : "android";
}

export function MobileLoginPage({ onNavigate }: Props) {
  const setAuth = useAuthStore((s) => s.setAuth);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const r = await login({
        email,
        password,
        device_name: getDeviceLabel(email),
        device_type: "phone",
        os: getOS(),
      });
      setAuth(r.user, r.device, r.tokens);
      wsService.connect();
      onNavigate("main");
    } catch (err) {
      setError(err instanceof Error ? err.message : "登录失败");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mobile-auth-page">
      <div className="mobile-auth-header">
        <div className="mobile-auth-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
          </svg>
        </div>
        <h1 className="mobile-auth-title">QuickDrop</h1>
        <p className="mobile-auth-subtitle">跨设备文件传输</p>
      </div>

      <form className="mobile-auth-form" onSubmit={handleSubmit}>
        {error && <div className="mobile-error-message">{error}</div>}

        <div className="mobile-field">
          <label className="mobile-label">邮箱</label>
          <input
            type="email"
            className="mobile-input"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="请输入邮箱"
            autoCapitalize="none"
            autoCorrect="off"
            required
          />
        </div>

        <div className="mobile-field">
          <label className="mobile-label">密码</label>
          <input
            type="password"
            className="mobile-input"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="请输入密码"
            autoCapitalize="none"
            autoCorrect="off"
            required
          />
        </div>

        <button type="submit" className="mobile-btn-primary" disabled={loading}>
          {loading ? "登录中..." : "登 录"}
        </button>

        <div className="mobile-auth-footer">
          <button type="button" className="mobile-link" onClick={() => onNavigate("register")}>
            注册新账号
          </button>
          <span className="mobile-divider">·</span>
          <button type="button" className="mobile-link" onClick={() => onNavigate("forgot")}>
            忘记密码
          </button>
        </div>
      </form>
    </div>
  );
}
