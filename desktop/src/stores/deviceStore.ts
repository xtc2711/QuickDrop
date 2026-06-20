// ============================================================
// 桌面客户端 — 设备列表状态管理 (Zustand)
// ============================================================

import { create } from "zustand";
import type { DeviceInfo } from "../../../../shared/types/index";

interface DeviceState {
  myDevices: DeviceInfo[];
  pairedDevices: DeviceInfo[];
  loading: boolean;

  setDevices: (myDevices: DeviceInfo[], pairedDevices: DeviceInfo[]) => void;
  addDevice: (device: DeviceInfo) => void;
  removeDevice: (deviceId: string) => void;
  setDeviceOnline: (deviceId: string, online: boolean) => void;
  setLoading: (loading: boolean) => void;
}

export const useDeviceStore = create<DeviceState>((set) => ({
  myDevices: [],
  pairedDevices: [],
  loading: false,

  setDevices: (myDevices, pairedDevices) => set({ myDevices, pairedDevices, loading: false }),

  addDevice: (device) =>
    set((state) => {
      const target = device.is_current ? "myDevices" : "myDevices";
      const existing = state[target].find((d) => d.id === device.id);
      if (existing) {
        return {
          [target]: state[target].map((d) => (d.id === device.id ? device : d)),
        };
      }
      return { [target]: [...state[target], device] };
    }),

  removeDevice: (deviceId) =>
    set((state) => ({
      myDevices: state.myDevices.filter((d) => d.id !== deviceId),
      pairedDevices: state.pairedDevices.filter((d) => d.id !== deviceId),
    })),

  setDeviceOnline: (deviceId, online) =>
    set((state) => ({
      myDevices: state.myDevices.map((d) =>
        d.id === deviceId ? { ...d, is_online: online } : d,
      ),
      pairedDevices: state.pairedDevices.map((d) =>
        d.id === deviceId ? { ...d, is_online: online } : d,
      ),
    })),

  setLoading: (loading) => set({ loading }),
}));
