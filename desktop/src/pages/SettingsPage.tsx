// ============================================================
// 桌面客户端 — 设置页面（桌面端双栏布局 + CSS 类）
// ============================================================

import { useState, FormEvent } from "react";
import { useAuthStore } from "../stores/authStore";
import { changePassword } from "../services/api";
import { validatePasswordStrength } from "../../../shared/utils/index";

export default function SettingsPage() {
  const user = useAuthStore((s) => s.user);

  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [revokeAll, setRevokeAll] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [loading, setLoading] = useState(false);

  const strength = newPassword ? validatePasswordStrength(newPassword) : null;
  const passwordsMatch = confirmPassword.length > 0 && newPassword === confirmPassword;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(""); setSuccess("");

    if (!oldPassword) { setError("请输入当前密码"); return; }
    if (!strength?.valid) { setError(strength?.errors.join("；") || "新密码不符合要求"); return; }
    if (newPassword !== confirmPassword) { setError("两次输入的新密码不一致"); return; }
    if (oldPassword === newPassword) { setError("新密码不能与当前密码相同"); return; }

    setLoading(true);
    try {
      const result = await changePassword({ old_password: oldPassword, new_password: newPassword, revoke_all_devices: revokeAll });
      setSuccess(result.message);
      setOldPassword(""); setNewPassword(""); setConfirmPassword("");
    } catch (err: any) {
      setError(err.message || "密码修改失败，请稍后重试");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">设置</h1>
          <p className="page-subtitle">账户信息与安全</p>
        </div>
      </div>

      <div className="two-column">
        {/* 左栏：账户信息 */}
        <div>
          <div className="card" style={{ marginBottom: 16 }}>
            <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 16, paddingBottom: 12, borderBottom: "1px solid var(--color-border)" }}>
              账户信息
            </h2>
            <div style={{ display: "flex", justifyContent: "space-between", padding: "10px 0" }}>
              <span style={{ fontSize: 14, color: "var(--color-text-secondary)" }}>邮箱</span>
              <span style={{ fontSize: 14, fontWeight: 500 }}>{user?.email}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", padding: "10px 0" }}>
              <span style={{ fontSize: 14, color: "var(--color-text-secondary)" }}>注册时间</span>
              <span style={{ fontSize: 14, fontWeight: 500 }}>
                {user?.created_at ? new Date(user.created_at).toLocaleDateString("zh-CN") : "-"}
              </span>
            </div>
          </div>

          {success && <div className="alert alert-success">{success}</div>}
        </div>

        {/* 右栏：修改密码 */}
        <div className="card">
          <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 16, paddingBottom: 12, borderBottom: "1px solid var(--color-border)" }}>
            修改密码
          </h2>

          {error && <div className="alert alert-error">{error}</div>}

          <form onSubmit={handleSubmit}>
            <div className="form-group">
              <label className="form-label">当前密码</label>
              <input type="password" value={oldPassword} onChange={(e) => setOldPassword(e.target.value)}
                placeholder="输入当前密码" autoComplete="current-password" />
            </div>

            <div className="form-group">
              <label className="form-label">新密码</label>
              <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)}
                placeholder="至少 8 位，含大小写字母和数字" autoComplete="new-password" />
              {newPassword && (
                <div style={{ marginTop: 8, padding: "8px 12px", background: "#fafafa", borderRadius: 6 }}>
                  {strength?.errors.map((err, i) => (
                    <div key={i} style={{ fontSize: 12, color: "#e53e3e", lineHeight: "22px" }}>✗ {err}</div>
                  ))}
                  {strength?.valid && (
                    <div style={{ fontSize: 12, color: "#38a169", lineHeight: "22px" }}>✓ 密码强度符合要求</div>
                  )}
                </div>
              )}
            </div>

            <div className="form-group">
              <label className="form-label">确认新密码</label>
              <input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="再次输入新密码" autoComplete="new-password" />
              {confirmPassword && (
                <div style={{ fontSize: 12, marginTop: 4, color: passwordsMatch ? "#38a169" : "#e53e3e" }}>
                  {passwordsMatch ? "✓ 密码一致" : "✗ 两次输入不一致"}
                </div>
              )}
            </div>

            <div className="form-group">
              <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 14 }}>
                <input type="checkbox" checked={revokeAll} onChange={(e) => setRevokeAll(e.target.checked)} style={{ width: "auto" }} />
                修改密码后强制其他设备重新登录
              </label>
            </div>

            <button type="submit" className="btn-primary" disabled={loading} style={{ width: "100%", padding: 12 }}>
              {loading ? "修改中..." : "修改密码"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
