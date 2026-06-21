// ============================================================
// 桌面客户端 — 管理后台页面
// 功能：仪表盘、用户管理、设备管理、连接监控
// ============================================================

import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import {
  fetchDashboardStats,
  fetchAdminUsers,
  fetchAdminDevices,
  toggleUserLock,
  toggleUserAdmin,
  deleteUser,
  forceRemoveDevice,
  checkIsAdmin,
  type DashboardStats,
  type AdminUserItem,
  type AdminDeviceItem,
  type PaginatedResult,
} from "../services/api";

type Tab = "dashboard" | "users" | "devices";

export default function AdminPage() {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<Tab>("dashboard");
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null); // null = loading
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
    type: "deleteUser" | "forceRemoveDevice";
    id: string;
    label: string;
  } | null>(null);

  // 检查管理员权限
  useEffect(() => {
    checkIsAdmin().then(setIsAdmin);
  }, []);

  // 加载仪表盘数据
  const loadStats = useCallback(async () => {
    try {
      const data = await fetchDashboardStats();
      setStats(data);
    } catch (err: any) {
      setError(err.message || "加载统计失败");
    }
  }, []);

  // 加载用户列表
  const loadUsers = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await fetchAdminUsers({
        page: userPage,
        page_size: 20,
        search: userSearch || undefined,
      });
      setUsers(data);
    } catch (err: any) {
      setError(err.message || "加载用户列表失败");
    } finally {
      setLoading(false);
    }
  }, [userPage, userSearch]);

  // 加载设备列表
  const loadDevices = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await fetchAdminDevices({
        page: devicePage,
        page_size: 20,
        search: deviceSearch || undefined,
      });
      setDevices(data);
    } catch (err: any) {
      setError(err.message || "加载设备列表失败");
    } finally {
      setLoading(false);
    }
  }, [devicePage, deviceSearch]);

  // 切换 Tab 时加载对应数据
  useEffect(() => {
    if (!isAdmin) return;
    if (activeTab === "dashboard") loadStats();
    if (activeTab === "users") loadUsers();
    if (activeTab === "devices") loadDevices();
  }, [activeTab, isAdmin, loadStats, loadUsers, loadDevices]);

  // 处理用户锁定/解锁
  const handleToggleLock = async (userId: string, _current: boolean) => {
    try {
      await toggleUserLock(userId);
      loadUsers();
    } catch (err: any) {
      setError(err.message || "操作失败");
    }
  };

  // 处理用户管理员权限切换
  const handleToggleAdmin = async (userId: string) => {
    try {
      await toggleUserAdmin(userId);
      loadUsers();
    } catch (err: any) {
      setError(err.message || "操作失败");
    }
  };

  // 确认删除用户
  const handleDeleteUser = async () => {
    if (!confirmAction || confirmAction.type !== "deleteUser") return;
    try {
      await deleteUser(confirmAction.id);
      setConfirmAction(null);
      loadUsers();
    } catch (err: any) {
      setError(err.message || "删除失败");
    }
  };

  // 确认强制移除设备
  const handleForceRemoveDevice = async () => {
    if (!confirmAction || confirmAction.type !== "forceRemoveDevice") return;
    try {
      await forceRemoveDevice(confirmAction.id);
      setConfirmAction(null);
      loadDevices();
    } catch (err: any) {
      setError(err.message || "移除失败");
    }
  };

  // 权限检查中
  if (isAdmin === null) {
    return (
      <div style={styles.container}>
        <div style={styles.loadingBox}>检查权限中...</div>
      </div>
    );
  }

  // 非管理员
  if (!isAdmin) {
    return (
      <div style={styles.container}>
        <div style={styles.header}>
          <button onClick={() => navigate("/devices")} style={styles.backBtn}>
            ← 返回
          </button>
          <h1 style={styles.title}>管理后台</h1>
          <div style={{ width: 60 }} />
        </div>
        <div style={styles.errorBox}>您没有管理员权限，无法访问此页面</div>
        <button
          onClick={() => navigate("/devices")}
          style={styles.primaryBtn}
        >
          返回设备列表
        </button>
      </div>
    );
  }

  // Tab 配置
  const tabs: { key: Tab; label: string }[] = [
    { key: "dashboard", label: "📊 仪表盘" },
    { key: "users", label: "👥 用户管理" },
    { key: "devices", label: "📱 设备管理" },
  ];

  return (
    <div style={styles.container}>
      {/* 顶部导航 */}
      <div style={styles.header}>
        <button onClick={() => navigate("/devices")} style={styles.backBtn}>
          ← 返回
        </button>
        <h1 style={styles.title}>管理后台</h1>
        <div style={{ width: 60 }} />
      </div>

      {/* 错误提示 */}
      {error && (
        <div style={styles.errorBox}>
          {error}
          <button onClick={() => setError("")} style={styles.dismissBtn}>✕</button>
        </div>
      )}

      {/* 确认对话框 */}
      {confirmAction && (
        <div style={styles.overlay}>
          <div style={styles.dialog}>
            <h3 style={styles.dialogTitle}>确认操作</h3>
            <p style={styles.dialogText}>
              确定要{confirmAction.type === "deleteUser" ? "删除用户" : "强制移除设备"} "
              {confirmAction.label}
              " 吗？此操作不可撤销。
            </p>
            <div style={styles.dialogBtns}>
              <button
                onClick={() => setConfirmAction(null)}
                style={styles.cancelBtn}
              >
                取消
              </button>
              <button
                onClick={
                  confirmAction.type === "deleteUser"
                    ? handleDeleteUser
                    : handleForceRemoveDevice
                }
                style={styles.dangerBtn}
              >
                确认
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Tab 栏 */}
      <div style={styles.tabBar}>
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            style={{
              ...styles.tab,
              ...(activeTab === tab.key ? styles.tabActive : {}),
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* 仪表盘 */}
      {activeTab === "dashboard" && stats && (
        <div style={styles.tabContent}>
          <div style={styles.statsGrid}>
            <StatCard label="总用户数" value={stats.total_users} color="#007aff" />
            <StatCard label="总设备数" value={stats.total_devices} color="#5856d6" />
            <StatCard label="在线设备" value={stats.online_devices} color="#34c759" />
            <StatCard label="锁定账户" value={stats.locked_users} color="#ff3b30" />
            <StatCard label="今日注册" value={stats.users_registered_today} color="#ff9500" />
            <StatCard label="本周注册" value={stats.users_registered_this_week} color="#af52de" />
          </div>
          <div style={styles.statNote}>
            24 小时内活跃用户: {stats.active_users_24h}
          </div>
        </div>
      )}

      {/* 用户管理 */}
      {activeTab === "users" && (
        <div style={styles.tabContent}>
          {/* 搜索栏 */}
          <div style={styles.searchBar}>
            <input
              type="text"
              value={userSearch}
              onChange={(e) => {
                setUserSearch(e.target.value);
                setUserPage(1);
              }}
              placeholder="搜索邮箱..."
              style={styles.searchInput}
            />
            <button onClick={loadUsers} style={styles.searchBtn}>
              搜索
            </button>
          </div>

          {/* 用户表格 */}
          {loading && <div style={styles.loadingBox}>加载中...</div>}
          {users && (
            <>
              <div style={styles.tableWrap}>
                <table style={styles.table}>
                  <thead>
                    <tr>
                      <th style={styles.th}>邮箱</th>
                      <th style={styles.th}>设备数</th>
                      <th style={styles.th}>在线</th>
                      <th style={styles.th}>状态</th>
                      <th style={styles.th}>角色</th>
                      <th style={styles.th}>注册时间</th>
                      <th style={styles.th}>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {users.items.map((u) => (
                      <tr key={u.id} style={styles.tr}>
                        <td style={styles.td}>{u.email}</td>
                        <td style={styles.td}>
                          {u.device_count}
                          <span style={styles.subtext}>
                            ({u.online_device_count} 在线)
                          </span>
                        </td>
                        <td style={styles.td}>
                          <StatusBadge online={u.online_device_count > 0} />
                        </td>
                        <td style={styles.td}>
                          {u.is_locked ? (
                            <span style={styles.lockedBadge}>🔒 已锁定</span>
                          ) : (
                            <span style={styles.activeBadge}>✓ 正常</span>
                          )}
                        </td>
                        <td style={styles.td}>
                          {u.is_admin ? (
                            <span style={styles.adminBadge}>管理员</span>
                          ) : (
                            <span style={styles.userBadge}>用户</span>
                          )}
                        </td>
                        <td style={styles.td}>
                          {new Date(u.created_at).toLocaleDateString("zh-CN")}
                        </td>
                        <td style={styles.tdActions}>
                          <button
                            onClick={() => handleToggleLock(u.id, u.is_locked)}
                            style={styles.actionBtn}
                          >
                            {u.is_locked ? "解锁" : "锁定"}
                          </button>
                          {!u.is_admin && (
                            <button
                              onClick={() => handleToggleAdmin(u.id)}
                              style={styles.actionBtn2}
                            >
                              授权
                            </button>
                          )}
                          {u.is_admin && (
                            <button
                              onClick={() => handleToggleAdmin(u.id)}
                              style={styles.actionBtn3}
                            >
                              降级
                            </button>
                          )}
                          <button
                            onClick={() =>
                              setConfirmAction({
                                type: "deleteUser",
                                id: u.id,
                                label: u.email,
                              })
                            }
                            style={styles.deleteBtn}
                            disabled={u.is_admin}
                          >
                            删除
                          </button>
                        </td>
                      </tr>
                    ))}
                    {users.items.length === 0 && (
                      <tr>
                        <td colSpan={7} style={styles.emptyRow}>
                          暂无用户数据
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              <Pagination
                page={users.page}
                totalPages={users.total_pages}
                total={users.total}
                onPageChange={setUserPage}
              />
            </>
          )}
        </div>
      )}

      {/* 设备管理 */}
      {activeTab === "devices" && (
        <div style={styles.tabContent}>
          {/* 搜索栏 */}
          <div style={styles.searchBar}>
            <input
              type="text"
              value={deviceSearch}
              onChange={(e) => {
                setDeviceSearch(e.target.value);
                setDevicePage(1);
              }}
              placeholder="搜索设备名称..."
              style={styles.searchInput}
            />
            <button onClick={loadDevices} style={styles.searchBtn}>
              搜索
            </button>
          </div>

          {/* 设备表格 */}
          {loading && <div style={styles.loadingBox}>加载中...</div>}
          {devices && (
            <>
              <div style={styles.tableWrap}>
                <table style={styles.table}>
                  <thead>
                    <tr>
                      <th style={styles.th}>设备名称</th>
                      <th style={styles.th}>类型</th>
                      <th style={styles.th}>系统</th>
                      <th style={styles.th}>状态</th>
                      <th style={styles.th}>所属用户</th>
                      <th style={styles.th}>首次上线</th>
                      <th style={styles.th}>最后活跃</th>
                      <th style={styles.th}>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {devices.items.map((d) => (
                      <tr key={d.id} style={styles.tr}>
                        <td style={styles.td}>{d.device_name}</td>
                        <td style={styles.td}>
                          <DeviceTypeLabel type={d.device_type} />
                        </td>
                        <td style={styles.td}>{OSLabel(d.os)}</td>
                        <td style={styles.td}>
                          <StatusBadge online={d.is_online} />
                        </td>
                        <td style={styles.td}>{d.user_email}</td>
                        <td style={styles.td}>
                          {new Date(d.first_seen).toLocaleDateString("zh-CN")}
                        </td>
                        <td style={styles.td}>
                          {new Date(d.last_seen).toLocaleString("zh-CN")}
                        </td>
                        <td style={styles.tdActions}>
                          <button
                            onClick={() =>
                              setConfirmAction({
                                type: "forceRemoveDevice",
                                id: d.id,
                                label: d.device_name,
                              })
                            }
                            style={styles.deleteBtn}
                          >
                            强制移除
                          </button>
                        </td>
                      </tr>
                    ))}
                    {devices.items.length === 0 && (
                      <tr>
                        <td colSpan={8} style={styles.emptyRow}>
                          暂无设备数据
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              <Pagination
                page={devices.page}
                totalPages={devices.total_pages}
                total={devices.total}
                onPageChange={setDevicePage}
              />
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ============================================================
// 子组件
// ============================================================

function StatCard({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color: string;
}) {
  return (
    <div style={{ ...statStyles.card, borderTopColor: color }}>
      <div style={statStyles.value}>{value.toLocaleString()}</div>
      <div style={statStyles.label}>{label}</div>
    </div>
  );
}

function StatusBadge({ online }: { online: boolean }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        padding: "2px 8px",
        borderRadius: 12,
        fontSize: 12,
        fontWeight: 600,
        background: online ? "#e6f9ed" : "#f2f2f7",
        color: online ? "#34c759" : "#8e8e93",
      }}
    >
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: "50%",
          background: online ? "#34c759" : "#8e8e93",
        }}
      />
      {online ? "在线" : "离线"}
    </span>
  );
}

function DeviceTypeLabel({ type }: { type: string }) {
  const map: Record<string, string> = {
    desktop: "💻 桌面",
    phone: "📱 手机",
    tablet: "📋 平板",
  };
  return <span>{map[type] || type}</span>;
}

function OSLabel(os: string) {
  const map: Record<string, string> = {
    windows: "Windows",
    macos: "macOS",
    android: "Android",
    ios: "iOS",
  };
  return <span>{map[os] || os}</span>;
}

function Pagination({
  page,
  totalPages,
  total,
  onPageChange,
}: {
  page: number;
  totalPages: number;
  total: number;
  onPageChange: (p: number) => void;
}) {
  return (
    <div style={pagStyles.container}>
      <span style={pagStyles.info}>共 {total} 条</span>
      <div style={pagStyles.buttons}>
        <button
          onClick={() => onPageChange(page - 1)}
          disabled={page <= 1}
          style={{
            ...pagStyles.btn,
            ...(page <= 1 ? pagStyles.btnDisabled : {}),
          }}
        >
          上一页
        </button>
        <span style={pagStyles.current}>
          {page} / {totalPages}
        </span>
        <button
          onClick={() => onPageChange(page + 1)}
          disabled={page >= totalPages}
          style={{
            ...pagStyles.btn,
            ...(page >= totalPages ? pagStyles.btnDisabled : {}),
          }}
        >
          下一页
        </button>
      </div>
    </div>
  );
}

// ============================================================
// 样式
// ============================================================

const styles: Record<string, React.CSSProperties> = {
  container: {
    maxWidth: 900,
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
    marginBottom: 20,
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
  tabBar: {
    display: "flex",
    gap: 4,
    background: "#fff",
    borderRadius: 12,
    padding: 4,
    marginBottom: 16,
    boxShadow: "0 1px 3px rgba(0,0,0,0.08)",
  },
  tab: {
    flex: 1,
    padding: "10px 0",
    border: "none",
    borderRadius: 10,
    fontSize: 14,
    fontWeight: 500,
    color: "#666",
    background: "transparent",
    cursor: "pointer",
    transition: "all 0.2s",
  },
  tabActive: {
    background: "#007aff",
    color: "#fff",
    fontWeight: 600,
  },
  tabContent: {
    background: "#fff",
    borderRadius: 12,
    padding: 20,
    boxShadow: "0 1px 3px rgba(0,0,0,0.08)",
  },
  statsGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(130px, 1fr))",
    gap: 12,
  },
  statNote: {
    marginTop: 16,
    textAlign: "center",
    fontSize: 13,
    color: "#8e8e93",
  },
  searchBar: {
    display: "flex",
    gap: 8,
    marginBottom: 16,
  },
  searchInput: {
    flex: 1,
    padding: "8px 12px",
    fontSize: 14,
    border: "1px solid #ddd",
    borderRadius: 8,
    outline: "none",
  },
  searchBtn: {
    padding: "8px 16px",
    fontSize: 14,
    fontWeight: 500,
    color: "#fff",
    background: "#007aff",
    border: "none",
    borderRadius: 8,
    cursor: "pointer",
  },
  tableWrap: {
    overflowX: "auto",
  },
  table: {
    width: "100%",
    borderCollapse: "collapse",
    fontSize: 13,
  },
  th: {
    textAlign: "left",
    padding: "10px 8px",
    borderBottom: "2px solid #e5e5ea",
    color: "#8e8e93",
    fontWeight: 600,
    fontSize: 12,
    textTransform: "uppercase",
    whiteSpace: "nowrap",
  },
  tr: {
    borderBottom: "1px solid #f0f0f0",
  },
  td: {
    padding: "10px 8px",
    color: "#1a1a1a",
    whiteSpace: "nowrap",
  },
  tdActions: {
    padding: "6px 8px",
    display: "flex",
    gap: 4,
    flexWrap: "wrap",
  },
  subtext: {
    fontSize: 11,
    color: "#8e8e93",
    marginLeft: 4,
  },
  lockedBadge: {
    color: "#ff3b30",
    fontWeight: 600,
    fontSize: 12,
  },
  activeBadge: {
    color: "#34c759",
    fontWeight: 600,
    fontSize: 12,
  },
  adminBadge: {
    padding: "2px 8px",
    borderRadius: 10,
    background: "#fff3e0",
    color: "#ff9500",
    fontSize: 12,
    fontWeight: 600,
  },
  userBadge: {
    padding: "2px 8px",
    borderRadius: 10,
    background: "#e8f0fe",
    color: "#007aff",
    fontSize: 12,
    fontWeight: 500,
  },
  actionBtn: {
    padding: "4px 10px",
    fontSize: 12,
    border: "1px solid #ff9500",
    borderRadius: 6,
    background: "#fff",
    color: "#ff9500",
    cursor: "pointer",
    fontWeight: 500,
  },
  actionBtn2: {
    padding: "4px 10px",
    fontSize: 12,
    border: "1px solid #007aff",
    borderRadius: 6,
    background: "#fff",
    color: "#007aff",
    cursor: "pointer",
    fontWeight: 500,
  },
  actionBtn3: {
    padding: "4px 10px",
    fontSize: 12,
    border: "1px solid #af52de",
    borderRadius: 6,
    background: "#fff",
    color: "#af52de",
    cursor: "pointer",
    fontWeight: 500,
  },
  deleteBtn: {
    padding: "4px 10px",
    fontSize: 12,
    border: "1px solid #ff3b30",
    borderRadius: 6,
    background: "#fff",
    color: "#ff3b30",
    cursor: "pointer",
    fontWeight: 500,
  },
  emptyRow: {
    padding: "32px 8px",
    textAlign: "center",
    color: "#8e8e93",
    fontSize: 14,
  },
  loadingBox: {
    textAlign: "center",
    padding: 40,
    color: "#8e8e93",
    fontSize: 14,
  },
  errorBox: {
    padding: "12px 16px",
    marginBottom: 16,
    background: "#fff5f5",
    border: "1px solid #fc8181",
    borderRadius: 8,
    color: "#c53030",
    fontSize: 14,
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
  },
  dismissBtn: {
    background: "none",
    border: "none",
    color: "#c53030",
    cursor: "pointer",
    fontSize: 16,
    padding: "0 4px",
  },
  primaryBtn: {
    width: "100%",
    padding: "12px 0",
    fontSize: 16,
    fontWeight: 600,
    color: "#fff",
    background: "#007aff",
    border: "none",
    borderRadius: 8,
    cursor: "pointer",
  },
  overlay: {
    position: "fixed",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    background: "rgba(0,0,0,0.4)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 1000,
  },
  dialog: {
    background: "#fff",
    borderRadius: 14,
    padding: 24,
    maxWidth: 360,
    width: "90%",
    boxShadow: "0 20px 60px rgba(0,0,0,0.2)",
  },
  dialogTitle: {
    fontSize: 17,
    fontWeight: 700,
    color: "#1a1a1a",
    margin: "0 0 8px 0",
  },
  dialogText: {
    fontSize: 14,
    color: "#666",
    lineHeight: "1.5",
    margin: "0 0 20px 0",
  },
  dialogBtns: {
    display: "flex",
    gap: 10,
    justifyContent: "flex-end",
  },
  cancelBtn: {
    padding: "8px 20px",
    fontSize: 14,
    border: "1px solid #ddd",
    borderRadius: 8,
    background: "#fff",
    color: "#333",
    cursor: "pointer",
  },
  dangerBtn: {
    padding: "8px 20px",
    fontSize: 14,
    border: "none",
    borderRadius: 8,
    background: "#ff3b30",
    color: "#fff",
    cursor: "pointer",
    fontWeight: 600,
  },
};

const statStyles: Record<string, React.CSSProperties> = {
  card: {
    background: "#fff",
    borderRadius: 10,
    padding: "16px 14px",
    borderTop: "3px solid",
    boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
  },
  value: {
    fontSize: 28,
    fontWeight: 700,
    color: "#1a1a1a",
  },
  label: {
    fontSize: 13,
    color: "#8e8e93",
    marginTop: 4,
  },
};

const pagStyles: Record<string, React.CSSProperties> = {
  container: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    paddingTop: 16,
    borderTop: "1px solid #f0f0f0",
    marginTop: 16,
  },
  info: {
    fontSize: 13,
    color: "#8e8e93",
  },
  buttons: {
    display: "flex",
    alignItems: "center",
    gap: 12,
  },
  btn: {
    padding: "6px 14px",
    fontSize: 13,
    border: "1px solid #ddd",
    borderRadius: 6,
    background: "#fff",
    color: "#007aff",
    cursor: "pointer",
    fontWeight: 500,
  },
  btnDisabled: {
    color: "#ccc",
    cursor: "not-allowed",
  },
  current: {
    fontSize: 13,
    fontWeight: 600,
    color: "#333",
  },
};
