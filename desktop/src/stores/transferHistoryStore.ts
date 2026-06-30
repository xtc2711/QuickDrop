// ============================================================
// 桌面客户端 — 传输历史状态管理 (Zustand + localStorage)
// 功能：最近 50 条传输记录持久化，支持手动清除
// ============================================================

import { create } from "zustand";

// ============================================================
// 类型定义
// ============================================================

export type TransferDirection = "sent" | "received";

export interface TransferHistoryRecord {
  /** 唯一标识 */
  id: string;
  /** 文件名 */
  fileName: string;
  /** 文件大小 (bytes) */
  fileSize: number;
  /** 目标设备名称 */
  deviceName: string;
  /** 传输方向 */
  direction: TransferDirection;
  /** 完成时间 (ISO 8601) */
  timestamp: string;
  /** 传输结果 */
  status: "success" | "failed";
  /** SHA256 是否匹配 */
  sha256Match: boolean;
  /** 错误信息（失败时） */
  errorMessage?: string;
  /** 文件保存路径 */
  filePath?: string;
}

interface TransferHistoryState {
  /** 按时间倒序排列的历史记录（最多 50 条） */
  records: TransferHistoryRecord[];

  /** 添加一条传输记录 */
  addRecord: (record: TransferHistoryRecord) => void;

  /** 删除单条记录 */
  removeRecord: (id: string) => void;

  /** 清空所有记录 */
  clearAll: () => void;

  /** 已发送数量 */
  sentCount: () => number;

  /** 已接收数量 */
  receivedCount: () => number;

  /** 成功数量 */
  successCount: () => number;
}

const STORAGE_KEY = "qd_transfer_history";
const MAX_RECORDS = 50;

// ============================================================
// 从 localStorage 恢复历史
// ============================================================

function loadRecords(): TransferHistoryRecord[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.slice(0, MAX_RECORDS);
  } catch {
    return [];
  }
}

function saveRecords(records: TransferHistoryRecord[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
  } catch {
    // localStorage 已满或不可用，静默失败
  }
}

// ============================================================
// Store
// ============================================================

export const useTransferHistoryStore = create<TransferHistoryState>(
  (set, get) => ({
    records: loadRecords(),

    addRecord: (record) => {
      set((state) => {
        const updated = [record, ...state.records].slice(0, MAX_RECORDS);
        saveRecords(updated);
        return { records: updated };
      });
    },

    removeRecord: (id) => {
      set((state) => {
        const updated = state.records.filter((r) => r.id !== id);
        saveRecords(updated);
        return { records: updated };
      });
    },

    clearAll: () => {
      localStorage.removeItem(STORAGE_KEY);
      set({ records: [] });
    },

    sentCount: () => get().records.filter((r) => r.direction === "sent").length,

    receivedCount: () =>
      get().records.filter((r) => r.direction === "received").length,

    successCount: () =>
      get().records.filter((r) => r.status === "success").length,
  }),
);

// ============================================================
// 恢复存储（应用初始化时调用）
// ============================================================

export function restoreTransferHistory(): void {
  useTransferHistoryStore.setState({ records: loadRecords() });
}
