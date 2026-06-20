// ============================================================
// 桌面客户端 — 重置密码页面
// 通过邮件中的链接访问: /reset-password?token=xxx
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

  if (!token && !success) {
    return (
      <div className="page-container">
        <h1 className="page-title">无效的访问</h1>
        <div className="card" style={{ textAlign: "center" }}>
          <p style={{ color: "var(--color-error)", marginBottom: 16 }}>
            缺少重置令牌。请从密码重置邮件中的链接访问此页面。
          </p>
          <Link to="/forgot-password" style={{ color: "var(--color-primary)" }}>
            重新请求密码重置
          </Link>
        </div>
      </div>
    );
  }

  if (success) {
    return (
      <div className="page-container">
        <h1 className="page-title">密码重置成功</h1>
        <div className="card" style={{ textAlign: "center" }}>
          <p style={{ fontSize: 15, lineHeight: 1.6, color: "var(--color-text)" }}>
            你的密码已成功重置。
            <br />
            所有设备已退出登录，请使用新密码重新登录。
          </p>
          <button
            className="btn-primary"
            style={{ marginTop: 24, padding: "12px 32px" }}
            onClick={() => navigate("/login")}
          >
            前往登录
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="page-container">
      <h1 className="page-title">重置密码</h1>

      <form onSubmit={handleSubmit} className="card">
        <p style={{ fontSize: 14, color: "var(--color-text-secondary)", marginBottom: 16 }}>
          输入你的新密码。重置后所有设备将退出登录。
        </p>

        <div className="form-group">
          <label className="form-label" htmlFor="newPassword">
            新密码
          </label>
          <input
            id="newPassword"
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            placeholder="至少 8 位，含大写、小写、数字"
            required
            autoFocus
            minLength={8}
          />
        </div>

        <div className="form-group">
          <label className="form-label" htmlFor="confirmPassword">
            确认新密码
          </label>
          <input
            id="confirmPassword"
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            placeholder="再次输入新密码"
            required
          />
        </div>

        {error && (
          <div className="form-error" style={{ marginBottom: 16 }}>
            {error}
          </div>
        )}

        <button
          type="submit"
          className="btn-primary"
          disabled={loading}
          style={{ width: "100%", padding: 12 }}
        >
          {loading ? "重置中..." : "重置密码"}
        </button>
      </form>
    </div>
  );
}
