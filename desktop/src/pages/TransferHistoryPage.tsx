// ============================================================
// 桌面客户端 — 传输历史页面
// 功能：展示最近 50 条传输记录，支持手动清除
// ============================================================

import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTransferHistoryStore } from "../stores/transferHistoryStore";
import type { TransferHistoryRecord } from "../stores/transferHistoryStore";

export default function TransferHistoryPage() {
  const navigate = useNavigate();
  const { records, removeRecord, clearAll } = useTransferHistoryStore();
  const [showClearConfirm, setShowClearConfirm] = useState(false);

  // ============================================================
  // 格式化
  // ============================================================

  const formatSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024)
      return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
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

      return date.toLocaleDateString("zh-CN", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return isoStr;
    }
  };

  const getDirectionLabel = (record: TransferHistoryRecord): string => {
    return record.direction === "sent" ? "发送" : "接收";
  };

  const getDirectionIcon = (record: TransferHistoryRecord): string => {
    return record.direction === "sent" ? "📤" : "📥";
  };

  const getDirectionColor = (record: TransferHistoryRecord): string => {
    return record.direction === "sent" ? "var(--color-primary)" : "#6c5ce7";
  };

  // ============================================================
  // 统计
  // ============================================================

  const sentTotal = records.filter((r) => r.direction === "sent").length;
  const receivedTotal = records.filter((r) => r.direction === "received").length;
  const successTotal = records.filter((r) => r.status === "success").length;
  const totalBytes = records
    .filter((r) => r.status === "success")
    .reduce((sum, r) => sum + r.fileSize, 0);

  return (
    <div className="page-container" style={{ maxWidth: 640 }}>
      {/* 顶部栏 */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 24,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button className="btn-ghost" onClick={() => navigate("/devices")}>
            ← 返回
          </button>
          <h1 style={{ fontSize: 20, fontWeight: 700 }}>传输历史</h1>
        </div>
        {records.length > 0 && (
          <button
            className="btn-ghost"
            style={{ fontSize: 13, color: "var(--color-error)" }}
            onClick={() => setShowClearConfirm(true)}
          >
            清空全部
          </button>
        )}
      </div>

      {/* 统计概览 */}
      {records.length > 0 && (
        <div
          style={{
            display: "flex",
            gap: 12,
            marginBottom: 20,
            flexWrap: "wrap",
          }}
        >
          <div
            className="card"
            style={{
              flex: "1 1 auto",
              textAlign: "center",
              padding: "12px 16px",
              minWidth: 0,
            }}
          >
            <div style={{ fontSize: 20, fontWeight: 700 }}>
              {records.length}
            </div>
            <div style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>
              总计
            </div>
          </div>
          <div
            className="card"
            style={{
              flex: "1 1 auto",
              textAlign: "center",
              padding: "12px 16px",
              minWidth: 0,
            }}
          >
            <div
              style={{
                fontSize: 20,
                fontWeight: 700,
                color: "var(--color-success)",
              }}
            >
              {successTotal}
            </div>
            <div style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>
              成功
            </div>
          </div>
          <div
            className="card"
            style={{
              flex: "1 1 auto",
              textAlign: "center",
              padding: "12px 16px",
              minWidth: 0,
            }}
          >
            <div style={{ fontSize: 20, fontWeight: 700 }}>{sentTotal}</div>
            <div style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>
              📤 发送
            </div>
          </div>
          <div
            className="card"
            style={{
              flex: "1 1 auto",
              textAlign: "center",
              padding: "12px 16px",
              minWidth: 0,
            }}
          >
            <div style={{ fontSize: 20, fontWeight: 700 }}>
              {receivedTotal}
            </div>
            <div style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>
              📥 接收
            </div>
          </div>
          <div
            className="card"
            style={{
              flex: "1 1 auto",
              textAlign: "center",
              padding: "12px 16px",
              minWidth: 0,
            }}
          >
            <div style={{ fontSize: 20, fontWeight: 700 }}>
              {formatSize(totalBytes)}
            </div>
            <div style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>
              已传输
            </div>
          </div>
        </div>
      )}

      {/* 空状态 */}
      {records.length === 0 && (
        <div
          style={{
            textAlign: "center",
            padding: "60px 20px",
            color: "var(--color-text-secondary)",
          }}
        >
          <div style={{ fontSize: 48, marginBottom: 16 }}>📋</div>
          <p style={{ fontSize: 15, fontWeight: 500 }}>暂无传输记录</p>
          <p style={{ fontSize: 13, marginTop: 4 }}>
            完成文件传输后，记录将显示在这里
          </p>
        </div>
      )}

      {/* 历史列表 */}
      {records.length > 0 && (
        <div className="card" style={{ padding: 0 }}>
          {records.map((record) => (
            <div
              key={record.id}
              style={{
                display: "flex",
                alignItems: "flex-start",
                padding: "12px 16px",
                borderBottom: "1px solid var(--color-border)",
                gap: 12,
              }}
            >
              {/* 方向图标 */}
              <span style={{ fontSize: 20, flexShrink: 0 }}>
                {record.status === "success"
                  ? getDirectionIcon(record)
                  : "❌"}
              </span>

              {/* 文件信息 */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontWeight: 500,
                    fontSize: 14,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                  title={record.fileName}
                >
                  {record.fileName}
                </div>
                <div style={{ fontSize: 12, color: "var(--color-text-secondary)", marginTop: 2 }}>
                  <span>{formatSize(record.fileSize)}</span>
                  <span style={{ margin: "0 6px" }}>·</span>
                  <span
                    style={{
                      color: getDirectionColor(record),
                      fontWeight: 500,
                    }}
                  >
                    {getDirectionLabel(record)}
                  </span>
                  <span style={{ margin: "0 6px" }}>·</span>
                  <span>至 {record.deviceName}</span>
                  <span style={{ margin: "0 6px" }}>·</span>
                  <span>{formatTime(record.timestamp)}</span>
                </div>
                {/* 状态标签 */}
                <div style={{ marginTop: 4 }}>
                  {record.status === "success" ? (
                    <span
                      style={{
                        fontSize: 11,
                        color: "var(--color-success)",
                        fontWeight: 500,
                      }}
                    >
                      ✓ SHA256 校验通过
                    </span>
                  ) : (
                    <span
                      style={{
                        fontSize: 11,
                        color: "var(--color-error)",
                        fontWeight: 500,
                      }}
                      title={record.errorMessage}
                    >
                      ✗{" "}
                      {record.errorMessage || "传输失败"}
                    </span>
                  )}
                </div>
              </div>

              {/* 删除按钮 */}
              <button
                className="btn-ghost"
                onClick={() => removeRecord(record.id)}
                style={{
                  fontSize: 14,
                  padding: "4px 8px",
                  color: "var(--color-text-secondary)",
                  flexShrink: 0,
                }}
                title="删除记录"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      {/* 底部提示 */}
      {records.length >= 50 && (
        <p
          style={{
            fontSize: 12,
            color: "var(--color-text-secondary)",
            textAlign: "center",
            marginTop: 12,
          }}
        >
          最多保留最近 50 条记录，新记录将自动替换最早记录
        </p>
      )}
      {records.length > 0 && records.length < 50 && (
        <p
          style={{
            fontSize: 12,
            color: "var(--color-text-secondary)",
            textAlign: "center",
            marginTop: 12,
          }}
        >
          共 {records.length}/50 条记录
        </p>
      )}

      {/* 清空确认弹窗 */}
      {showClearConfirm && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.3)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 100,
          }}
          onClick={() => setShowClearConfirm(false)}
        >
          <div
            className="card"
            style={{ maxWidth: 360, width: "100%" }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ marginBottom: 16 }}>清空传输历史</h3>
            <p style={{ fontSize: 13, color: "var(--color-text-secondary)", marginBottom: 16 }}>
              确定要清空全部 {records.length} 条传输记录吗？此操作不可撤销。
            </p>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button className="btn-ghost" onClick={() => setShowClearConfirm(false)}>
                取消
              </button>
              <button
                className="btn-danger"
                onClick={() => {
                  clearAll();
                  setShowClearConfirm(false);
                }}
              >
                确认清空
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
