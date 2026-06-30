import { useState, FormEvent } from "react";
import { useAuthStore } from "../../stores/authStore";
import { wsService } from "../../services/websocket";
import { register } from "../../services/api";

interface Props { onNavigate: (page: string) => void; }

export function MobileRegisterPage({ onNavigate }: Props) {
  const setAuth = useAuthStore((s) => s.setAuth);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    if (password !== confirm) { setError("两次输入的密码不一致"); return; }
    if (password.length < 8) { setError("密码至少需要 8 位字符"); return; }
    if (!/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/[0-9]/.test(password)) {
      setError("密码必须包含大写字母、小写字母和数字"); return;
    }
    setLoading(true);
    try {
      const r = await register({ email, password, device_name: getDeviceLabel(email), device_type: "phone", os: getOS() });
      setAuth(r.user, r.device, r.tokens);
      wsService.connect();
      onNavigate("main");
    } catch (err) {
      setError(err instanceof Error ? err.message : "注册失败");
    } finally { setLoading(false); }
  };

  return (
    <div className="mobile-page">
      <div className="mobile-register-header">
        <button className="mobile-back-btn" onClick={() => onNavigate("login")}>
          ← 返回
        </button>
      </div>

      <div className="mobile-register-body">
        <h2>创建账号</h2>
        <p className="subtitle">注册 QuickDrop，开始跨设备文件传输</p>

        {error && <div className="mobile-alert mobile-alert-error">{error}</div>}

        <form onSubmit={handleSubmit}>
          <div className="mobile-field">
            <label>邮箱</label>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)}
              placeholder="请输入邮箱地址" autoCapitalize="none" autoCorrect="off" required autoFocus />
          </div>
          <div className="mobile-field">
            <label>密码</label>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)}
              placeholder="至少 8 位，含大小写字母和数字" required />
          </div>
          <div className="mobile-field">
            <label>确认密码</label>
            <input type="password" value={confirm} onChange={e => setConfirm(e.target.value)}
              placeholder="再次输入密码" required />
          </div>

          <button type="submit" className="mobile-btn" disabled={loading}>
            {loading ? "注册中..." : "注册"}
          </button>
        </form>

        <p className="footer-text">
          已有账号？<button onClick={() => onNavigate("login")}>立即登录</button>
        </p>
      </div>
    </div>
  );
}

function getDeviceLabel(email: string): string {
  const prefix = email.split("@")[0] || "用户";
  return /iPhone|iPad/i.test(navigator.userAgent) ? `${prefix} 的 iPhone` : `${prefix} 的 手机`;
}

function getOS(): "ios" | "android" {
  return /iphone|ipad/i.test(navigator.userAgent) ? "ios" : "android";
}
