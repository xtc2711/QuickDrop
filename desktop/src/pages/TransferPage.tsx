// ============================================================
// 桌面客户端 — 文件传输页面
// 支持拖拽传输和文件选择传输
// ============================================================

import { useState, useCallback, DragEvent } from "react";
import { useParams, useNavigate } from "react-router-dom";
import type { TransferProgress, TransferStatus } from "../../../../shared/types/index";
import { webrtcService } from "../services/webrtc";
import { wsService } from "../services/websocket";

interface FileItem {
  id: string;
  file: globalThis.File;
  progress: TransferProgress;
}

export default function TransferPage() {
  const { deviceId } = useParams<{ deviceId: string }>();
  const navigate = useNavigate();

  const [files, setFiles] = useState<FileItem[]>([]);
  const [isDragOver, setIsDragOver] = useState(false);
  const [transferring, setTransferring] = useState(false);
  const [connectingDevice, setConnectingDevice] = useState<string | null>(null);
  const [connectionError, setConnectionError] = useState<string | null>(null);

  const addFiles = useCallback((fileList: globalThis.FileList | globalThis.File[]) => {
    const newFiles: FileItem[] = Array.from(fileList).map((file) => ({
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      file,
      progress: {
        file_id: "",
        file_name: file.name,
        total_bytes: file.size,
        transferred_bytes: 0,
        percentage: 0,
        speed_bps: 0,
        eta_seconds: 0,
        status: "pending" as TransferStatus,
      },
    }));
    setFiles((prev) => [...prev, ...newFiles].slice(0, 20)); // 最多 20 个文件
  }, []);

  const handleDragOver = (e: DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = (e: DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  };

  const handleDrop = (e: DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    if (e.dataTransfer.files.length > 0) {
      addFiles(e.dataTransfer.files);
    }
  };

  const handleFileSelect = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    input.onchange = () => {
      if (input.files) addFiles(input.files);
    };
    input.click();
  };

  const removeFile = (fileId: string) => {
    setFiles((prev) => prev.filter((f) => f.id !== fileId));
  };

  const startTransfer = async () => {
    if (!deviceId) return;

    setTransferring(true);
    setConnectionError(null);
    setConnectingDevice(deviceId);

    // 注册连接成功回调 → 后续文件传输引擎使用
    webrtcService.setDataChannelReadyHandler((devId, _dc) => {
      console.log(`✅ DataChannel ready for device ${devId}`);
      setConnectingDevice(null);
      // 将文件状态更新为 connecting → 等待后续传输引擎
      setFiles((prev) =>
        prev.map((f) => ({
          ...f,
          progress: { ...f.progress, status: "connecting" as TransferStatus },
        })),
      );
      // TODO (Week 4 Item 2): 通过 DataChannel 发送文件数据
    });

    // 注册连接状态回调
    webrtcService.setConnectionChangeHandler((_devId, state) => {
      if (state === "failed") {
        setConnectionError("连接设备失败，请检查对方是否在线后重试");
        setTransferring(false);
        setConnectingDevice(null);
      }
      if (state === "connected") {
        setConnectingDevice(null);
      }
      if (state === "disconnected") {
        setConnectionError("设备连接已断开");
        setTransferring(false);
        setConnectingDevice(null);
      }
    });

    // 发起 WebRTC 连接（作为 Offer 侧）
    try {
      await webrtcService.createOffer(deviceId, (msg) => {
        wsService.send(msg.type, msg.payload, msg.target);
      });
    } catch (err) {
      console.error("Failed to create WebRTC offer:", err);
      setConnectionError("创建 P2P 连接失败，请重试");
      setTransferring(false);
      setConnectingDevice(null);
    }
  };

  const formatSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  };

  const getStatusLabel = (status: TransferStatus): string => {
    const labels: Record<TransferStatus, string> = {
      pending: "等待中",
      connecting: "连接中",
      transferring: "传输中",
      verifying: "校验中",
      completed: "已完成",
      failed: "失败",
      cancelled: "已取消",
    };
    return labels[status];
  };

  const getStatusColor = (status: TransferStatus): string => {
    const colors: Record<TransferStatus, string> = {
      pending: "var(--color-text-secondary)",
      connecting: "var(--color-warning)",
      transferring: "var(--color-primary)",
      verifying: "var(--color-warning)",
      completed: "var(--color-success)",
      failed: "var(--color-danger)",
      cancelled: "var(--color-text-secondary)",
    };
    return colors[status];
  };

  return (
    <div className="page-container" style={{ maxWidth: 640 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 24 }}>
        <button className="btn-ghost" onClick={() => navigate("/devices")}>
          ← 返回
        </button>
        <h1 style={{ fontSize: 20, fontWeight: 700 }}>文件传输</h1>
      </div>

      {/* 拖拽区域 */}
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        style={{
          border: `2px dashed ${isDragOver ? "var(--color-primary)" : "var(--color-border)"}`,
          borderRadius: "var(--radius)",
          padding: "40px 20px",
          textAlign: "center",
          background: isDragOver ? "var(--color-primary-light)" : "var(--color-surface)",
          transition: "all 0.2s",
          marginBottom: 16,
        }}
      >
        <div style={{ fontSize: 48, marginBottom: 12 }}>📁</div>
        <p style={{ fontSize: 15, fontWeight: 500 }}>
          拖拽文件到这里
        </p>
        <p style={{ fontSize: 13, color: "var(--color-text-secondary)", marginTop: 4 }}>
          或
        </p>
        <button
          className="btn-primary"
          onClick={handleFileSelect}
          style={{ marginTop: 8 }}
        >
          选择文件
        </button>
      </div>

      {/* 文件列表 */}
      {files.length > 0 && (
        <div>
          <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>
            待传输文件（{files.length}）
          </h2>
          <div className="card" style={{ padding: 0 }}>
            {files.map((item) => (
              <div
                key={item.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  padding: "12px 16px",
                  borderBottom: "1px solid var(--color-border)",
                  gap: 12,
                }}
              >
                <span style={{ fontSize: 20 }}>📄</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 500, fontSize: 14, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {item.file.name}
                  </div>
                  <div style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>
                    {formatSize(item.file.size)} ·{" "}
                    <span style={{ color: getStatusColor(item.progress.status) }}>
                      {getStatusLabel(item.progress.status)}
                    </span>
                  </div>
                  {item.progress.status === "transferring" && (
                    <div style={{ marginTop: 4 }}>
                      <div
                        style={{
                          height: 4,
                          background: "var(--color-border)",
                          borderRadius: 2,
                          overflow: "hidden",
                        }}
                      >
                        <div
                          style={{
                            height: "100%",
                            width: `${item.progress.percentage}%`,
                            background: "var(--color-primary)",
                            transition: "width 0.3s",
                          }}
                        />
                      </div>
                    </div>
                  )}
                </div>
                {item.progress.status === "pending" && (
                  <button
                    className="btn-ghost"
                    onClick={() => removeFile(item.id)}
                    style={{ fontSize: 18, padding: "4px 8px" }}
                  >
                    ✕
                  </button>
                )}
              </div>
            ))}
          </div>

          {connectingDevice && (
            <div style={{
              textAlign: "center",
              padding: "10px 0",
              fontSize: 13,
              color: "var(--color-primary)",
            }}>
              🔗 正在建立 P2P 加密直连...
            </div>
          )}
          {connectionError && (
            <div style={{
              textAlign: "center",
              padding: "10px 0",
              fontSize: 13,
              color: "var(--color-danger)",
            }}>
              ❌ {connectionError}
            </div>
          )}

          <button
            className="btn-primary"
            onClick={startTransfer}
            disabled={transferring}
            style={{ width: "100%", padding: 12, marginTop: 16 }}
          >
            {transferring ? "准备传输..." : `开始传输 (${files.length} 个文件)`}
          </button>
        </div>
      )}
    </div>
  );
}
