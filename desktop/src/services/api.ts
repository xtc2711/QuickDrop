// ============================================================
// 桌面客户端 — API 客户端
// 封装对认证服务的 HTTP 请求
// ============================================================

import { useAuthStore } from "../stores/authStore";
import type {
  AuthResponse,
  ChangePasswordRequest,
  LoginRequest,
  RegisterRequest,
} from "../../../shared/types/index";

const AUTH_BASE = "http://localhost:3001/api/v1";

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
