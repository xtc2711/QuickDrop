// ============================================================
// 桌面客户端 — 认证状态管理 (Zustand)
// ============================================================

import { create } from "zustand";
import type { PublicUser, DeviceInfo, TokenPair } from "../../../../shared/types/index";

interface AuthState {
  // 状态
  isAuthenticated: boolean;
  user: PublicUser | null;
  currentDevice: DeviceInfo | null;
  accessToken: string | null;
  refreshToken: string | null;

  // 操作
  setAuth: (user: PublicUser, device: DeviceInfo, tokens: TokenPair) => void;
  setTokens: (tokens: TokenPair) => void;
  logout: () => void;
  getAuthHeader: () => { Authorization: string } | Record<string, never>;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  isAuthenticated: false,
  user: null,
  currentDevice: null,
  accessToken: null,
  refreshToken: null,

  setAuth: (user, device, tokens) => {
    // 持久化到 localStorage
    localStorage.setItem("qd_access_token", tokens.access_token);
    localStorage.setItem("qd_refresh_token", tokens.refresh_token);
    localStorage.setItem("qd_user", JSON.stringify(user));
    localStorage.setItem("qd_device", JSON.stringify(device));

    set({
      isAuthenticated: true,
      user,
      currentDevice: device,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
    });
  },

  setTokens: (tokens) => {
    localStorage.setItem("qd_access_token", tokens.access_token);
    localStorage.setItem("qd_refresh_token", tokens.refresh_token);
    set({
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
    });
  },

  logout: () => {
    localStorage.removeItem("qd_access_token");
    localStorage.removeItem("qd_refresh_token");
    localStorage.removeItem("qd_user");
    localStorage.removeItem("qd_device");
    set({
      isAuthenticated: false,
      user: null,
      currentDevice: null,
      accessToken: null,
      refreshToken: null,
    });
  },

  getAuthHeader: () => {
    const token = get().accessToken;
    return token ? { Authorization: `Bearer ${token}` } : {};
  },
}));

/**
 * 从 localStorage 恢复认证状态（应用初始化时调用）
 */
export function restoreAuthState(): void {
  const accessToken = localStorage.getItem("qd_access_token");
  const refreshToken = localStorage.getItem("qd_refresh_token");
  const user = localStorage.getItem("qd_user");
  const device = localStorage.getItem("qd_device");

  if (accessToken && user && device) {
    try {
      useAuthStore.setState({
        isAuthenticated: true,
        user: JSON.parse(user),
        currentDevice: JSON.parse(device),
        accessToken,
        refreshToken,
      });
    } catch {
      // 数据损坏，清除
      localStorage.clear();
    }
  }
}
