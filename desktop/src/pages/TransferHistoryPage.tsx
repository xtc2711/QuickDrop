// ============================================================
// 桌面客户端 — 传输历史页面（桌面端宽表布局）
// ============================================================

import { useState } from "react";
import { useTransferHistoryStore } from "../stores/transferHistoryStore";
import type { TransferHistoryRecord } from "../stores/transferHistoryStore";

export default function TransferHistoryPage() {
  const { records, removeRecord, clearAll } = useTransferHistoryStore();
  const [showClearConfirm, setShowClearConfirm] = useState(false);

  const formatSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  };

  const formatTime = (isoStr: string): string => {
    try {
      const date = new Date(isoStr);
      const now = new Date();
      const diffMs = now.getTime() - date.getTime();
      const diffMin = Math.floor(diffMs / 60000);
      const diffHour = Math.floor(diffMs / 3600000);
      const diffDay = Math.floor(diffMs / 86400000);
      if (diffMin < 1) return "刚刚";
      if (diffMin < 60) return `${diffMin}分钟前`;
      if (diffHour < 24) return `${diffHour}小时前`;
      if (diffDay < 7) return `${diffDay}天前`;
      return date.toLocaleDateString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
    } catch { return isoStr; }
  };

  const getDirectionIcon = (r: TransferHistoryRecord) => r.direction === "sent" ? "📤" : "📥";
  const getDirectionLabel = (r: TransferHistoryRecord) => r.direction === "sent" ? "发送" : "接收";

  const sentTotal = records.filter((r) => r.direction === "sent").length;
  const receivedTotal = records.filter((r) => r.direction === "received").length;
  const successTotal = records.filter((r) => r.status === "success").length;
  const totalBytes = records.filter((r) => r.status === "success").reduce((sum, r) => sum + r.fileSize, 0);

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">传输历史</h1>
          <p className="page-subtitle">最近 {records.length}/50 条记录</p>
        </div>
        {records.length > 0 && (
          <button className="btn-ghost" style={{ color: "var(--color-danger)" }} onClick={() => setShowClearConfirm(true)}>
            清空全部
          </button>
        )}
      </div>

      {/* 统计卡片 */}
      {records.length > 0 && (
        <div className="stats-grid">
          <div className="stat-card"><div className="stat-value">{records.length}</div><div className="stat-label">总计</div></div>
          <div className="stat-card"><div className="stat-value" style={{ color: "var(--color-success)" }}>{successTotal}</div><div className="stat-label">成功</div></div>
          <div className="stat-card"><div className="stat-value" style={{ color: "var(--color-primary)" }}>{sentTotal}</div><div className="stat-label">📤 发送</div></div>
          <div className="stat-card"><div className="stat-value" style={{ color: "#6c5ce7" }}>{receivedTotal}</div><div className="stat-label">📥 接收</div></div>
          <div className="stat-card"><div className="stat-value" style={{ fontSize: 22 }}>{formatSize(totalBytes)}</div><div className="stat-label">已传输</div></div>
        </div>
      )}

      {/* 传输记录表格 */}
      {records.length > 0 ? (
        <div className="card" style={{ padding: 0, overflowX: "auto" }}>
          <table className="data-table">
            <thead>
              <tr>
                <th style={{ width: 36 }}></th>
                <th>文件名</th>
                <th>大小</th>
                <th>方向</th>
                <th>目标设备</th>
                <th>状态</th>
                <th>时间</th>
                <th style={{ width: 60 }}></th>
              </tr>
            </thead>
            <tbody>
              {records.map((record) => (
                <tr key={record.id}>
                  <td style={{ textAlign: "center" }}>{getDirectionIcon(record)}</td>
                  <td style={{ maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    <span title={record.filePath || record.fileName}>
                      {record.fileName}
                    </span>
                    {record.filePath && (
                      <div style={{ fontSize: 11, color: "var(--color-primary)", cursor: "pointer", textDecoration: "underline" }}
                        onClick={() => {
                          const dir = record.filePath!.replace(/[/\\][^/\\]*$/, "");
                          window.open(`file://${dir}`, "_blank");
                        }}>
                        📂 {record.filePath}
                      </div>
                    )}
                  </td>
                  <td>{formatSize(record.fileSize)}</td>
                  <td>
                    <span className={`badge ${record.direction === "sent" ? "badge-info" : ""}`}
                      style={record.direction !== "sent" ? { background: "#ede9fe", color: "#6c5ce7" } : undefined}>
                      {getDirectionLabel(record)}
                    </span>
                  </td>
                  <td>{record.deviceName}</td>
                  <td>
                    <span className={`badge ${record.status === "success" ? "badge-success" : "badge-danger"}`}>
                      {record.status === "success" ? "✓ 成功" : "✗ 失败"}
                    </span>
                  </td>
                  <td style={{ fontSize: 12, color: "var(--color-text-secondary)", whiteSpace: "nowrap" }}>
                    {formatTime(record.timestamp)}
                  </td>
                  <td>
                    <button className="btn-ghost btn-sm" style={{ color: "var(--color-text-muted)", fontSize: 11 }}
                      onClick={() => removeRecord(record.id)}>
                      删除
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="empty-state">
          <div className="empty-icon">📋</div>
          <p>暂无传输记录</p>
        </div>
      )}

      {/* 清空确认弹窗 */}
      {showClearConfirm && (
        <div className="modal-overlay" onClick={() => setShowClearConfirm(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()} style={{ padding: 24 }}>
            <h3 style={{ marginBottom: 12 }}>确认清空</h3>
            <p style={{ fontSize: 13, color: "var(--color-text-secondary)", marginBottom: 16 }}>
              确定要清空全部传输历史记录吗？此操作不可撤销。
            </p>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button className="btn-ghost" onClick={() => setShowClearConfirm(false)}>取消</button>
              <button className="btn-danger" onClick={() => { clearAll(); setShowClearConfirm(false); }}>确认清空</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
