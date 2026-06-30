// ============================================================
// 客户端 — 设备列表状态管理 (Zustand + localStorage 持久化)
// ============================================================

import { create } from "zustand";
import type { DeviceInfo } from "../../../shared/types/index";

const PAIRED_KEY = "qd_paired_devices";

function loadPaired(): DeviceInfo[] {
  try {
    const raw = localStorage.getItem(PAIRED_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function savePaired(devices: DeviceInfo[]) {
  try { localStorage.setItem(PAIRED_KEY, JSON.stringify(devices)); } catch { /* ok */ }
}

interface DeviceState {
  myDevices: DeviceInfo[];
  pairedDevices: DeviceInfo[];
  loading: boolean;

  setDevices: (myDevices: DeviceInfo[], pairedDevices: DeviceInfo[]) => void;
  addDevice: (device: DeviceInfo) => void;
  addPairedDevice: (device: DeviceInfo) => void;
  removePairedDevice: (deviceId: string) => void;
  removeDevice: (deviceId: string) => void;
  setDeviceOnline: (deviceId: string, online: boolean) => void;
  setLoading: (loading: boolean) => void;
}

export const useDeviceStore = create<DeviceState>((set, get) => ({
  myDevices: [],
  pairedDevices: loadPaired(),
  loading: false,

  setDevices: (myDevices, pairedDevices) => set((state) => ({
    myDevices,
    pairedDevices: pairedDevices.length > 0 ? pairedDevices : state.pairedDevices,
    loading: false,
  })),

  addDevice: (device) =>
    set((state) => {
      const existing = state.myDevices.find((d) => d.id === device.id);
      if (existing) {
        return { myDevices: state.myDevices.map((d) => (d.id === device.id ? { ...device, is_online: true } : d)) };
      }
      return { myDevices: [...state.myDevices, { ...device, is_online: true }] };
    }),

  addPairedDevice: (device: DeviceInfo) => {
    const existing = get().pairedDevices.find((d) => d.id === device.id);
    const updated = existing
      ? get().pairedDevices.map((d) => (d.id === device.id ? { ...device, is_online: true } : d))
      : [...get().pairedDevices, { ...device, is_online: true }];
    savePaired(updated);
    set({ pairedDevices: updated });
  },

  removePairedDevice: (deviceId: string) => {
    const updated = get().pairedDevices.filter((d) => d.id !== deviceId);
    savePaired(updated);
    set({ pairedDevices: updated });
  },

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
