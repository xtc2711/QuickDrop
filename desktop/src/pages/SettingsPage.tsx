// ============================================================
// 桌面客户端 — 设置页面
// 功能：密码修改、账户安全设置
// ============================================================

import { useState, FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useAuthStore } from "../stores/authStore";
import { changePassword } from "../services/api";
import { validatePasswordStrength } from "../../../shared/utils/index";

export default function SettingsPage() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);

  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [revokeAll, setRevokeAll] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [loading, setLoading] = useState(false);

  // 新密码实时强度反馈
  const strength = newPassword ? validatePasswordStrength(newPassword) : null;
  const passwordsMatch =
    confirmPassword.length > 0 && newPassword === confirmPassword;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    setSuccess("");

    // 前端校验
    if (!oldPassword) {
      setError("请输入当前密码");
      return;
    }
    if (!strength?.valid) {
      setError(strength?.errors.join("；") || "新密码不符合要求");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("两次输入的新密码不一致");
      return;
    }
    if (oldPassword === newPassword) {
      setError("新密码不能与当前密码相同");
      return;
    }

    setLoading(true);
    try {
      const result = await changePassword({
        old_password: oldPassword,
        new_password: newPassword,
        revoke_all_devices: revokeAll,
      });
      setSuccess(result.message);
      setOldPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (err: any) {
      setError(err.message || "密码修改失败，请稍后重试");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={styles.container}>
      {/* 顶部导航 */}
      <div style={styles.header}>
        <button onClick={() => navigate("/devices")} style={styles.backBtn}>
          ← 返回
        </button>
        <h1 style={styles.title}>设置</h1>
        <div style={{ width: 60 }} />
      </div>

      {/* 用户信息卡片 */}
      <div style={styles.card}>
        <h2 style={styles.sectionTitle}>账户信息</h2>
        <div style={styles.infoRow}>
          <span style={styles.label}>邮箱</span>
          <span style={styles.value}>{user?.email}</span>
        </div>
        <div style={styles.infoRow}>
          <span style={styles.label}>注册时间</span>
          <span style={styles.value}>
            {user?.created_at
              ? new Date(user.created_at).toLocaleDateString("zh-CN")
              : "-"}
          </span>
        </div>
      </div>

      {/* 密码修改表单 */}
      <div style={styles.card}>
        <h2 style={styles.sectionTitle}>修改密码</h2>

        {error && <div style={styles.errorBox}>{error}</div>}
        {success && <div style={styles.successBox}>{success}</div>}

        <form onSubmit={handleSubmit}>
          {/* 当前密码 */}
          <div style={styles.fieldGroup}>
            <label style={styles.fieldLabel}>当前密码</label>
            <input
              type="password"
              value={oldPassword}
              onChange={(e) => setOldPassword(e.target.value)}
              placeholder="输入当前密码"
              style={styles.input}
              autoComplete="current-password"
            />
          </div>

          {/* 新密码 */}
          <div style={styles.fieldGroup}>
            <label style={styles.fieldLabel}>新密码</label>
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="至少 8 位，含大小写字母和数字"
              style={styles.input}
              autoComplete="new-password"
            />
            {/* 密码强度指示 */}
            {newPassword && (
              <div style={styles.strengthBox}>
                {strength?.errors.map((err, i) => (
                  <div key={i} style={styles.strengthError}>
                    ✗ {err}
                  </div>
                ))}
                {strength?.valid && (
                  <div style={styles.strengthOk}>✓ 密码强度符合要求</div>
                )}
              </div>
            )}
          </div>

          {/* 确认新密码 */}
          <div style={styles.fieldGroup}>
            <label style={styles.fieldLabel}>确认新密码</label>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="再次输入新密码"
              style={styles.input}
              autoComplete="new-password"
            />
            {confirmPassword && (
              <div
                style={
                  passwordsMatch ? styles.strengthOk : styles.strengthError
                }
              >
                {passwordsMatch ? "✓ 密码一致" : "✗ 两次输入不一致"}
              </div>
            )}
          </div>

          {/* 撤销其他设备 */}
          <div style={styles.checkboxGroup}>
            <label style={styles.checkboxLabel}>
              <input
                type="checkbox"
                checked={revokeAll}
                onChange={(e) => setRevokeAll(e.target.checked)}
                style={styles.checkbox}
              />
              <span>修改密码后强制其他设备重新登录</span>
            </label>
          </div>

          {/* 提交按钮 */}
          <button
            type="submit"
            disabled={loading}
            style={{
              ...styles.submitBtn,
              ...(loading ? styles.submitBtnDisabled : {}),
            }}
          >
            {loading ? "修改中..." : "修改密码"}
          </button>
        </form>
      </div>
    </div>
  );
}

// ============================================================
// 内联样式
// ============================================================

const styles: Record<string, React.CSSProperties> = {
  container: {
    maxWidth: 480,
    margin: "0 auto",
    padding: "24px 20px",
    minHeight: "100vh",
    background: "#f5f5f5",
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  },
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 24,
  },
  backBtn: {
    background: "none",
    border: "none",
    color: "#007aff",
    fontSize: 15,
    cursor: "pointer",
    padding: "8px 0",
  },
  title: {
    fontSize: 18,
    fontWeight: 700,
    color: "#1a1a1a",
    margin: 0,
  },
  card: {
    background: "#fff",
    borderRadius: 12,
    padding: "20px 20px",
    marginBottom: 16,
    boxShadow: "0 1px 3px rgba(0,0,0,0.08)",
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: 600,
    color: "#1a1a1a",
    marginTop: 0,
    marginBottom: 16,
    paddingBottom: 12,
    borderBottom: "1px solid #f0f0f0",
  },
  infoRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "8px 0",
  },
  label: {
    fontSize: 14,
    color: "#666",
  },
  value: {
    fontSize: 14,
    color: "#1a1a1a",
    fontWeight: 500,
  },
  fieldGroup: {
    marginBottom: 16,
  },
  fieldLabel: {
    display: "block",
    fontSize: 14,
    fontWeight: 500,
    color: "#333",
    marginBottom: 6,
  },
  input: {
    width: "100%",
    padding: "10px 12px",
    fontSize: 15,
    border: "1px solid #ddd",
    borderRadius: 8,
    outline: "none",
    boxSizing: "border-box",
    transition: "border-color 0.2s",
  },
  strengthBox: {
    marginTop: 8,
    padding: "8px 12px",
    background: "#fafafa",
    borderRadius: 6,
  },
  strengthError: {
    fontSize: 13,
    color: "#e53e3e",
    lineHeight: "22px",
  },
  strengthOk: {
    fontSize: 13,
    color: "#38a169",
    lineHeight: "22px",
  },
  checkboxGroup: {
    marginBottom: 16,
  },
  checkboxLabel: {
    display: "flex",
    alignItems: "center",
    fontSize: 14,
    color: "#555",
    cursor: "pointer",
  },
  checkbox: {
    marginRight: 8,
    width: 16,
    height: 16,
    cursor: "pointer",
  },
  submitBtn: {
    width: "100%",
    padding: "12px 0",
    fontSize: 16,
    fontWeight: 600,
    color: "#fff",
    background: "#007aff",
    border: "none",
    borderRadius: 8,
    cursor: "pointer",
    transition: "background 0.2s",
  },
  submitBtnDisabled: {
    background: "#a0c4ff",
    cursor: "not-allowed",
  },
  errorBox: {
    padding: "10px 14px",
    marginBottom: 16,
    background: "#fff5f5",
    border: "1px solid #fc8181",
    borderRadius: 8,
    color: "#c53030",
    fontSize: 14,
  },
  successBox: {
    padding: "10px 14px",
    marginBottom: 16,
    background: "#f0fff4",
    border: "1px solid #68d391",
    borderRadius: 8,
    color: "#2f855a",
    fontSize: 14,
  },
};
