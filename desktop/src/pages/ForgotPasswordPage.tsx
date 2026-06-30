// ============================================================
// 桌面客户端 — 忘记密码页面（桌面端左右分栏布局）
// ============================================================

import { useState, FormEvent } from "react";
import { Link } from "react-router-dom";
import { forgotPassword } from "../services/api";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await forgotPassword({ email });
      setSuccess(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "请求失败，请稍后重试");
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
            忘记密码？没关系。
            <br />
            输入注册邮箱，我们会发送重置链接。
          </p>
        </div>
      </div>

      <div className="auth-form-area">
        <div className="auth-form-card">
          <h2>忘记密码</h2>
          <p className="auth-subtitle">输入注册邮箱以接收密码重置邮件</p>

          {success ? (
            <div style={{ textAlign: "center" }}>
              <div className="alert alert-success">
                如果 <strong>{email}</strong> 已注册 QuickDrop 账号，重置密码的邮件已发送。
              </div>
              <p style={{ fontSize: 13, color: "var(--color-text-secondary)", marginTop: 12 }}>
                请在 15 分钟内点击邮件中的链接完成密码重置。没有收到？请检查垃圾邮件箱。
              </p>
              <button
                style={{
                  background: "none",
                  border: "none",
                  color: "var(--color-primary)",
                  fontSize: 14,
                  cursor: "pointer",
                  marginTop: 12,
                }}
                onClick={() => setSuccess(false)}
              >
                重新发送
              </button>
              <p style={{ marginTop: 20 }}>
                <Link to="/login" style={{ fontSize: 14, color: "var(--color-text-secondary)" }}>
                  返回登录
                </Link>
              </p>
            </div>
          ) : (
            <form onSubmit={handleSubmit}>
              <div className="form-group">
                <label className="form-label" htmlFor="email">注册邮箱</label>
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

              {error && <div className="alert alert-error">{error}</div>}

              <button type="submit" className="btn-primary" disabled={loading} style={{ width: "100%", padding: 12, marginTop: 8 }}>
                {loading ? "发送中..." : "发送重置邮件"}
              </button>

              <p style={{ textAlign: "center", marginTop: 20, fontSize: 13, color: "var(--color-text-secondary)" }}>
                <Link to="/login" style={{ color: "var(--color-primary)" }}>返回登录</Link>
              </p>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
