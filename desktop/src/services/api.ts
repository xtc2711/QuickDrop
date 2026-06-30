// ============================================================
// 桌面客户端 — API 客户端
// 封装对认证服务的 HTTP 请求
// ============================================================

import { useAuthStore } from "../stores/authStore";
import type {
  AuthResponse,
  ChangePasswordRequest,
  ForgotPasswordRequest,
  LoginRequest,
  RegisterRequest,
  ResetPasswordRequest,
} from "../../../shared/types/index";

// 检测是否在 iOS 模拟器中运行
function getApiBase(): string {
  if (typeof window === "undefined") return "http://localhost:3003/api/v1";
  const hostname = window.location.hostname;
  // iOS 模拟器加载 Vite 时 host 是 localhost，但 localhost 指向模拟器自己
  // 需要检测 navigator.platform 来判断是否在 iOS 模拟器中
  const isIOSSimulator = /iPhone|iPad/.test(navigator.userAgent) && hostname === "localhost";
  if (isIOSSimulator) {
    // 模拟器中 localhost:1420 是 Vite 服务，但 localhost:3003 是模拟器自己
    // 需要通过 Vite 的 host header 推断真实 IP
    // 这里我们直接用电脑 IP（需要手动配置或环境变量）
    return "http://localhost:3003/api/v1";
  }
  if (hostname !== "localhost" && hostname !== "127.0.0.1") {
    return `http://${hostname}:3003/api/v1`;
  }
  return "http://localhost:3003/api/v1";
}

const AUTH_BASE = getApiBase();

/**
 * 通用 fetch 封装：自动附加 Bearer Token
 */
async function request<T>(
  path: string,
  options: RequestInit = {},
  useAuth = true,
): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...((options.headers as Record<string, string>) || {}),
  };

  if (useAuth) {
    const authHeader = useAuthStore.getState().getAuthHeader();
    Object.assign(headers, authHeader);
  }

  const res = await fetch(`${AUTH_BASE}${path}`, {
    ...options,
    headers,
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: { message: "网络错误" } }));
    throw new ApiError(res.status, error.error?.message || "请求失败");
  }

  return res.json();
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = "ApiError";
  }
}

/**
 * 注册
 */
export async function register(data: RegisterRequest): Promise<AuthResponse> {
  return request<AuthResponse>("/auth/register", {
    method: "POST",
    body: JSON.stringify(data),
  }, false);
}

/**
 * 登录
 */
export async function login(data: LoginRequest): Promise<AuthResponse> {
  return request<AuthResponse>("/auth/login", {
    method: "POST",
    body: JSON.stringify(data),
  }, false);
}

/**
 * 刷新 Token
 */
export async function refreshAccessToken(
  refreshToken: string,
): Promise<{ tokens: { access_token: string; refresh_token: string } }> {
  return request("/auth/refresh", {
    method: "POST",
    body: JSON.stringify({ refresh_token: refreshToken }),
  }, false);
}

/**
 * 退出登录
 */
export async function logout(allDevices = false): Promise<void> {
  return request("/auth/logout", {
    method: "POST",
    body: JSON.stringify({ all_devices: allDevices }),
  });
}

/**
 * 忘记密码 — 请求重置邮件
 */
export async function forgotPassword(
  data: ForgotPasswordRequest,
): Promise<{ message: string }> {
  return request<{ message: string }>("/auth/forgot-password", {
    method: "POST",
    body: JSON.stringify(data),
  }, false);
}

/**
 * 重置密码 — 使用邮件中的令牌
 */
export async function resetPassword(
  data: ResetPasswordRequest,
): Promise<{ message: string }> {
  return request<{ message: string }>("/auth/reset-password", {
    method: "POST",
    body: JSON.stringify(data),
  }, false);
}

/**
 * 修改密码
 */
export async function changePassword(
  data: ChangePasswordRequest,
): Promise<{ message: string }> {
  return request("/auth/change-password", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

/**
 * 获取设备列表
 */
export async function fetchDevices(): Promise<{
  my_devices: unknown[];
  paired_devices: unknown[];
}> {
  return request("/devices");
}

/**
 * 远程移除设备
 */
export async function removeDevice(deviceId: string): Promise<{ message: string }> {
  return request(`/devices/${deviceId}`, { method: "DELETE" });
}

// ============================================================
// Admin API（需要管理员权限）
// ============================================================

export interface DashboardStats {
  total_users: number;
  total_devices: number;
  online_devices: number;
  locked_users: number;
  users_registered_today: number;
  users_registered_this_week: number;
  active_users_24h: number;
}

export interface AdminUserItem {
  id: string;
  email: string;
  is_locked: boolean;
  is_admin: boolean;
  failed_login_attempts: number;
  device_count: number;
  online_device_count: number;
  created_at: string;
  last_active: string | null;
}

export interface AdminDeviceItem {
  id: string;
  device_name: string;
  device_type: string;
  os: string;
  is_online: boolean;
  user_email: string;
  user_id: string;
  first_seen: string;
  last_seen: string;
}

export interface PaginatedResult<T> {
  items: T[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
}

/**
 * 检查当前用户是否为管理员
 * 如果请求成功（200）则说明是管理员，如果 403 则不是
 */
export async function checkIsAdmin(): Promise<boolean> {
  try {
    await request("/admin/stats");
    return true;
  } catch {
    return false;
  }
}

/**
 * 获取仪表盘统计
 */
export async function fetchDashboardStats(): Promise<DashboardStats> {
  return request("/admin/stats");
}

/**
 * 获取用户列表
 */
export async function fetchAdminUsers(params: {
  page?: number;
  page_size?: number;
  search?: string;
  is_locked?: boolean;
} = {}): Promise<PaginatedResult<AdminUserItem>> {
  const query = new URLSearchParams();
  if (params.page) query.set("page", String(params.page));
  if (params.page_size) query.set("page_size", String(params.page_size));
  if (params.search) query.set("search", params.search);
  if (params.is_locked !== undefined) query.set("is_locked", String(params.is_locked));
  const qs = query.toString();
  return request(`/admin/users${qs ? `?${qs}` : ""}`);
}

/**
 * 切换用户锁定状态
 */
export async function toggleUserLock(userId: string): Promise<{ is_locked: boolean }> {
  return request(`/admin/users/${userId}/lock`, { method: "POST" });
}

/**
 * 切换用户管理员权限
 */
export async function toggleUserAdmin(userId: string): Promise<{ is_admin: boolean }> {
  return request(`/admin/users/${userId}/admin`, { method: "POST" });
}

/**
 * 删除用户
 */
export async function deleteUser(userId: string): Promise<{ message: string }> {
  return request(`/admin/users/${userId}`, { method: "DELETE" });
}

/**
 * 获取设备列表（管理员视角）
 */
export async function fetchAdminDevices(params: {
  page?: number;
  page_size?: number;
  search?: string;
  is_online?: boolean;
} = {}): Promise<PaginatedResult<AdminDeviceItem>> {
  const query = new URLSearchParams();
  if (params.page) query.set("page", String(params.page));
  if (params.page_size) query.set("page_size", String(params.page_size));
  if (params.search) query.set("search", params.search);
  if (params.is_online !== undefined) query.set("is_online", String(params.is_online));
  const qs = query.toString();
  return request(`/admin/devices${qs ? `?${qs}` : ""}`);
}

/**
 * 强制移除设备（管理员）
 */
export async function forceRemoveDevice(deviceId: string): Promise<{ message: string }> {
  return request(`/admin/devices/${deviceId}`, { method: "DELETE" });
}
