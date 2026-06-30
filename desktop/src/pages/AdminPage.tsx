// ============================================================
// 桌面客户端 — 管理后台页面（桌面端全宽布局 + CSS 类）
// ============================================================

import { useState, useEffect, useCallback } from "react";
import {
  fetchDashboardStats, fetchAdminUsers, fetchAdminDevices,
  toggleUserLock, toggleUserAdmin, deleteUser, forceRemoveDevice, checkIsAdmin,
  type DashboardStats, type AdminUserItem, type AdminDeviceItem, type PaginatedResult,
} from "../services/api";

type Tab = "dashboard" | "users" | "devices";

export default function AdminPage() {
  const [activeTab, setActiveTab] = useState<Tab>("dashboard");
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [users, setUsers] = useState<PaginatedResult<AdminUserItem> | null>(null);
  const [devices, setDevices] = useState<PaginatedResult<AdminDeviceItem> | null>(null);
  const [userSearch, setUserSearch] = useState("");
  const [deviceSearch, setDeviceSearch] = useState("");
  const [userPage, setUserPage] = useState(1);
  const [devicePage, setDevicePage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [confirmAction, setConfirmAction] = useState<{
    type: "deleteUser" | "forceRemoveDevice"; id: string; label: string;
  } | null>(null);

  useEffect(() => { checkIsAdmin().then(setIsAdmin); }, []);

  const loadStats = useCallback(async () => {
    try { setStats(await fetchDashboardStats()); } catch (err: any) { setError(err.message || "加载统计失败"); }
  }, []);

  const loadUsers = useCallback(async () => {
    setLoading(true); setError("");
    try { setUsers(await fetchAdminUsers({ page: userPage, page_size: 20, search: userSearch || undefined })); }
    catch (err: any) { setError(err.message || "加载用户列表失败"); }
    finally { setLoading(false); }
  }, [userPage, userSearch]);

  const loadDevices = useCallback(async () => {
    setLoading(true); setError("");
    try { setDevices(await fetchAdminDevices({ page: devicePage, page_size: 20, search: deviceSearch || undefined })); }
    catch (err: any) { setError(err.message || "加载设备列表失败"); }
    finally { setLoading(false); }
  }, [devicePage, deviceSearch]);

  useEffect(() => {
    if (!isAdmin) return;
    if (activeTab === "dashboard") loadStats();
    if (activeTab === "users") loadUsers();
    if (activeTab === "devices") loadDevices();
  }, [activeTab, isAdmin, loadStats, loadUsers, loadDevices]);

  const handleToggleLock = async (userId: string) => { try { await toggleUserLock(userId); loadUsers(); } catch (err: any) { setError(err.message || "操作失败"); } };
  const handleToggleAdmin = async (userId: string) => { try { await toggleUserAdmin(userId); loadUsers(); } catch (err: any) { setError(err.message || "操作失败"); } };

  const handleConfirmAction = async () => {
    if (!confirmAction) return;
    try {
      if (confirmAction.type === "deleteUser") await deleteUser(confirmAction.id);
      else await forceRemoveDevice(confirmAction.id);
      setConfirmAction(null);
      confirmAction.type === "deleteUser" ? loadUsers() : loadDevices();
    } catch (err: any) { setError(err.message || "操作失败"); }
  };

  if (isAdmin === null) return <div style={{ padding: 40, textAlign: "center", color: "var(--color-text-muted)" }}>检查权限中...</div>;

  if (!isAdmin) {
    return (
      <div>
        <h1 className="page-title">管理后台</h1>
        <div className="alert alert-error" style={{ marginTop: 16 }}>您没有管理员权限，无法访问此页面</div>
      </div>
    );
  }

  const tabs = [
    { key: "dashboard" as Tab, label: "📊 仪表盘" },
    { key: "users" as Tab, label: "👥 用户管理" },
    { key: "devices" as Tab, label: "📱 设备管理" },
  ];

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">管理后台</h1>
          <p className="page-subtitle">系统概览、用户与设备管理</p>
        </div>
      </div>

      {error && (
        <div className="alert alert-error" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          {error}
          <button onClick={() => setError("")} style={{
            background: "none", border: "none", color: "#c53030", cursor: "pointer", fontSize: 16, padding: "0 4px"
          }}>✕</button>
        </div>
      )}

      {confirmAction && (
        <div className="modal-overlay" onClick={() => setConfirmAction(null)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()} style={{ padding: 24 }}>
            <h3 style={{ fontSize: 17, fontWeight: 700, marginBottom: 8 }}>确认操作</h3>
            <p style={{ fontSize: 14, color: "var(--color-text-secondary)", marginBottom: 20, lineHeight: 1.5 }}>
              确定要{confirmAction.type === "deleteUser" ? "删除用户" : "强制移除设备"} "{confirmAction.label}" 吗？此操作不可撤销。
            </p>
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button className="btn-ghost" onClick={() => setConfirmAction(null)}>取消</button>
              <button className="btn-danger" onClick={handleConfirmAction}>确认</button>
            </div>
          </div>
        </div>
      )}

      {/* Tab 栏 */}
      <div style={{ display: "flex", gap: 4, background: "var(--color-surface)", borderRadius: "var(--radius-lg)", padding: 4, marginBottom: 20, boxShadow: "var(--shadow)" }}>
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            style={{
              flex: 1, padding: "10px 0", border: "none", borderRadius: 10, fontSize: 14, fontWeight: 500,
              cursor: "pointer", transition: "all 0.15s",
              background: activeTab === tab.key ? "var(--color-primary)" : "transparent",
              color: activeTab === tab.key ? "#fff" : "var(--color-text-secondary)",
            }}
          >{tab.label}</button>
        ))}
      </div>

      {/* 仪表盘 */}
      {activeTab === "dashboard" && stats && (
        <div>
          <div className="stats-grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))" }}>
            <StatCard label="总用户数" value={stats.total_users} color="#3b82f6" />
            <StatCard label="总设备数" value={stats.total_devices} color="#6366f1" />
            <StatCard label="在线设备" value={stats.online_devices} color="#22c55e" />
            <StatCard label="锁定账户" value={stats.locked_users} color="#ef4444" />
            <StatCard label="今日注册" value={stats.users_registered_today} color="#f59e0b" />
            <StatCard label="本周注册" value={stats.users_registered_this_week} color="#a855f7" />
          </div>
          <p style={{ textAlign: "center", fontSize: 13, color: "var(--color-text-muted)", marginTop: 16 }}>
            24 小时内活跃用户: {stats.active_users_24h}
          </p>
        </div>
      )}

      {/* 用户管理 */}
      {activeTab === "users" && (
        <div>
          <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
            <input type="text" value={userSearch} onChange={(e) => { setUserSearch(e.target.value); setUserPage(1); }}
              placeholder="搜索邮箱..." style={{ flex: 1 }} />
            <button className="btn-primary" onClick={loadUsers}>搜索</button>
          </div>

          {loading && <div style={{ textAlign: "center", padding: 40, color: "var(--color-text-muted)" }}>加载中...</div>}

          {users && (
            <>
              <div className="card" style={{ padding: 0, overflowX: "auto" }}>
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>邮箱</th><th>设备数</th><th>在线</th><th>状态</th><th>角色</th><th>注册时间</th><th>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {users.items.map((u) => (
                      <tr key={u.id}>
                        <td style={{ maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={u.email}>
                          {u.email}
                        </td>
                        <td>{u.device_count} <span style={{ fontSize: 11, color: "var(--color-text-muted)" }}>({u.online_device_count} 在线)</span></td>
                        <td><span className={`badge ${u.online_device_count > 0 ? "badge-success" : ""}`} style={u.online_device_count === 0 ? { background: "#f1f5f9", color: "#94a3b8" } : undefined}>
                          {u.online_device_count > 0 ? "在线" : "离线"}</span></td>
                        <td><span className={`badge ${u.is_locked ? "badge-danger" : "badge-success"}`}>{u.is_locked ? "🔒 已锁定" : "✓ 正常"}</span></td>
                        <td><span className={`badge ${u.is_admin ? "badge-warning" : "badge-info"}`}>{u.is_admin ? "管理员" : "用户"}</span></td>
                        <td style={{ fontSize: 12, whiteSpace: "nowrap" }}>{new Date(u.created_at).toLocaleDateString("zh-CN")}</td>
                        <td>
                          <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                            <button onClick={() => handleToggleLock(u.id)}
                              style={{ padding: "3px 8px", fontSize: 11, border: "1px solid #f59e0b", borderRadius: 4, background: "#fff", color: "#f59e0b", cursor: "pointer" }}>
                              {u.is_locked ? "解锁" : "锁定"}</button>
                            {!u.is_admin ? (
                              <button onClick={() => handleToggleAdmin(u.id)}
                                style={{ padding: "3px 8px", fontSize: 11, border: "1px solid var(--color-primary)", borderRadius: 4, background: "#fff", color: "var(--color-primary)", cursor: "pointer" }}>
                                授权</button>
                            ) : (
                              <button onClick={() => handleToggleAdmin(u.id)}
                                style={{ padding: "3px 8px", fontSize: 11, border: "1px solid #a855f7", borderRadius: 4, background: "#fff", color: "#a855f7", cursor: "pointer" }}>
                                降级</button>
                            )}
                            <button onClick={() => setConfirmAction({ type: "deleteUser", id: u.id, label: u.email })}
                              disabled={u.is_admin}
                              style={{ padding: "3px 8px", fontSize: 11, border: "1px solid #ef4444", borderRadius: 4, background: "#fff", color: "#ef4444", cursor: u.is_admin ? "not-allowed" : "pointer", opacity: u.is_admin ? 0.5 : 1 }}>
                              删除</button>
                          </div>
                        </td>
                      </tr>
                    ))}
                    {users.items.length === 0 && <tr><td colSpan={7} style={{ padding: "32px 8px", textAlign: "center", color: "var(--color-text-muted)" }}>暂无用户数据</td></tr>}
                  </tbody>
                </table>
              </div>
              <Pagination page={users.page} totalPages={users.total_pages} total={users.total} onPageChange={setUserPage} />
            </>
          )}
        </div>
      )}

      {/* 设备管理 */}
      {activeTab === "devices" && (
        <div>
          <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
            <input type="text" value={deviceSearch} onChange={(e) => { setDeviceSearch(e.target.value); setDevicePage(1); }}
              placeholder="搜索设备名称..." style={{ flex: 1 }} />
            <button className="btn-primary" onClick={loadDevices}>搜索</button>
          </div>

          {loading && <div style={{ textAlign: "center", padding: 40, color: "var(--color-text-muted)" }}>加载中...</div>}

          {devices && (
            <>
              <div className="card" style={{ padding: 0, overflowX: "auto" }}>
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>设备名称</th><th>类型</th><th>系统</th><th>状态</th><th>所属用户</th><th>首次上线</th><th>最后活跃</th><th>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {devices.items.map((d) => (
                      <tr key={d.id}>
                        <td>{d.device_name}</td>
                        <td>{({ desktop: "💻 桌面", phone: "📱 手机", tablet: "📋 平板" } as Record<string, string>)[d.device_type] || d.device_type}</td>
                        <td>{({ windows: "Windows", macos: "macOS", android: "Android", ios: "iOS" } as Record<string, string>)[d.os] || d.os}</td>
                        <td><span className={`badge ${d.is_online ? "badge-success" : ""}`} style={!d.is_online ? { background: "#f1f5f9", color: "#94a3b8" } : undefined}>
                          {d.is_online ? "在线" : "离线"}</span></td>
                        <td>{d.user_email}</td>
                        <td style={{ fontSize: 12, whiteSpace: "nowrap" }}>{new Date(d.first_seen).toLocaleDateString("zh-CN")}</td>
                        <td style={{ fontSize: 12, whiteSpace: "nowrap" }}>{new Date(d.last_seen).toLocaleString("zh-CN")}</td>
                        <td>
                          <button onClick={() => setConfirmAction({ type: "forceRemoveDevice", id: d.id, label: d.device_name })}
                            style={{ padding: "3px 8px", fontSize: 11, border: "1px solid #ef4444", borderRadius: 4, background: "#fff", color: "#ef4444", cursor: "pointer" }}>
                            强制移除</button>
                        </td>
                      </tr>
                    ))}
                    {devices.items.length === 0 && <tr><td colSpan={8} style={{ padding: "32px 8px", textAlign: "center", color: "var(--color-text-muted)" }}>暂无设备数据</td></tr>}
                  </tbody>
                </table>
              </div>
              <Pagination page={devices.page} totalPages={devices.total_pages} total={devices.total} onPageChange={setDevicePage} />
            </>
          )}
        </div>
      )}
    </div>
  );
}

/* ============================================================
   子组件
   ============================================================ */

function StatCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="stat-card" style={{ borderTop: `3px solid ${color}`, textAlign: "left" }}>
      <div className="stat-value">{value.toLocaleString()}</div>
      <div className="stat-label">{label}</div>
    </div>
  );
}

function Pagination({ page, totalPages, total, onPageChange }: {
  page: number; totalPages: number; total: number; onPageChange: (p: number) => void;
}) {
  return (
    <div className="pagination" style={{ justifyContent: "space-between", paddingTop: 12, borderTop: "1px solid var(--color-border)", marginTop: 12 }}>
      <span style={{ fontSize: 13, color: "var(--color-text-muted)" }}>共 {total} 条</span>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <button onClick={() => onPageChange(page - 1)} disabled={page <= 1}>上一页</button>
        <span style={{ fontSize: 13, fontWeight: 600 }}>{page} / {totalPages}</span>
        <button onClick={() => onPageChange(page + 1)} disabled={page >= totalPages}>下一页</button>
      </div>
    </div>
  );
}
