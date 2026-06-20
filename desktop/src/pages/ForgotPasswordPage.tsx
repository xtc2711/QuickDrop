// ============================================================
// 桌面客户端 — 忘记密码页面
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
      const result = await forgotPassword({ email });
      setSuccess(true);
      // 显示后端返回的消息
      setError(""); // 清除错误
      void result; // 使用 result 避免 lint 警告
    } catch (err) {
      setError(err instanceof Error ? err.message : "请求失败，请稍后重试");
    } finally {
      setLoading(false);
    }
  };

  if (success) {
    return (
      <div className="page-container">
        <h1 className="page-title">邮件已发送</h1>
        <div className="card" style={{ textAlign: "center" }}>
          <p style={{ fontSize: 15, lineHeight: 1.6, color: "var(--color-text)" }}>
            如果 <strong>{email}</strong> 已注册 QuickDrop 账号，
            <br />
            重置密码的邮件已发送到该邮箱。
          </p>
          <p style={{ fontSize: 13, color: "var(--color-text-secondary)", marginTop: 8 }}>
            请在 15 分钟内点击邮件中的链接完成密码重置。
          </p>
          <p style={{ fontSize: 13, color: "var(--color-text-secondary)", marginTop: 4 }}>
            没有收到邮件？请检查垃圾邮件箱。
          </p>
          <Link
            to="/forgot-password"
            style={{
              display: "inline-block",
              marginTop: 16,
              color: "var(--color-primary)",
              fontSize: 14,
            }}
            onClick={() => setSuccess(false)}
          >
            重新发送
          </Link>
          <br />
          <Link
            to="/login"
            style={{
              display: "inline-block",
              marginTop: 24,
              fontSize: 14,
              color: "var(--color-text-secondary)",
            }}
          >
            返回登录
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="page-container">
      <h1 className="page-title">忘记密码</h1>

      <form onSubmit={handleSubmit} className="card">
        <p style={{ fontSize: 14, color: "var(--color-text-secondary)", marginBottom: 16 }}>
          输入你的注册邮箱，我们将发送一封密码重置邮件。
        </p>

        <div className="form-group">
          <label className="form-label" htmlFor="email">
            注册邮箱
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
          {loading ? "发送中..." : "发送重置邮件"}
        </button>

        <p
          style={{
            textAlign: "center",
            marginTop: 16,
            fontSize: 13,
            color: "var(--color-text-secondary)",
          }}
        >
          <Link to="/login" style={{ color: "var(--color-primary)" }}>
            返回登录
          </Link>
        </p>
      </form>
    </div>
  );
}
