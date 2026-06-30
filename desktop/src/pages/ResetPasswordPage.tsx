// ============================================================
// 桌面客户端 — 重置密码页面（桌面端左右分栏布局）
// ============================================================

import { useState, FormEvent } from "react";
import { useSearchParams, Link, useNavigate } from "react-router-dom";
import { resetPassword } from "../services/api";

export default function ResetPasswordPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const token = searchParams.get("token") || "";

  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");

    if (!token) {
      setError("缺少重置令牌，请从邮件中的链接访问此页面");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("两次输入的密码不一致");
      return;
    }
    if (newPassword.length < 8) {
      setError("新密码至少需要 8 位");
      return;
    }

    setLoading(true);
    try {
      await resetPassword({ token, new_password: newPassword });
      setSuccess(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "重置失败，请重新请求密码重置");
    } finally {
      setLoading(false);
    }
  };

  const formContent = () => {
    if (!token && !success) {
      return (
        <>
          <h2>无效的访问</h2>
          <p className="auth-subtitle">缺少重置令牌，请从密码重置邮件中的链接访问此页面。</p>
          <div className="alert alert-error">缺少重置令牌</div>
          <p style={{ textAlign: "center", marginTop: 16 }}>
            <Link to="/forgot-password" style={{ color: "var(--color-primary)", fontSize: 14 }}>
              重新请求密码重置
            </Link>
          </p>
        </>
      );
    }

    if (success) {
      return (
        <>
          <h2>密码重置成功</h2>
          <p className="auth-subtitle">你的密码已成功重置。所有设备已退出登录。</p>
          <div className="alert alert-success">密码已成功重置，请使用新密码重新登录。</div>
          <button
            className="btn-primary"
            style={{ marginTop: 16, width: "100%", padding: 12 }}
            onClick={() => navigate("/login")}
          >
            前往登录
          </button>
        </>
      );
    }

    return (
      <>
        <h2>重置密码</h2>
        <p className="auth-subtitle">输入新密码，重置后所有设备将退出登录。</p>

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label" htmlFor="newPassword">新密码</label>
            <input
              id="newPassword"
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="至少 8 位，含大写、小写、数字"
              required
              autoFocus
            />
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="confirmPassword">确认新密码</label>
            <input
              id="confirmPassword"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="再次输入新密码"
              required
            />
          </div>

          {error && <div className="alert alert-error">{error}</div>}

          <button type="submit" className="btn-primary" disabled={loading} style={{ width: "100%", padding: 12, marginTop: 8 }}>
            {loading ? "重置中..." : "重置密码"}
          </button>
        </form>
      </>
    );
  };

  return (
    <div className="auth-page">
      <div className="auth-brand">
        <div className="auth-brand-content">
          <h1>QuickDrop</h1>
          <p>重置你的密码，恢复对设备的访问。</p>
        </div>
      </div>

      <div className="auth-form-area">
        <div className="auth-form-card">
          {formContent()}
        </div>
      </div>
    </div>
  );
}
