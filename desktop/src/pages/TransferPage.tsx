// ============================================================
// 桌面客户端 — 文件传输页面
// 支持拖拽传输和文件选择传输
// 集成 FileTransferService 引擎：分块发送、CRC32 校验、
// SHA256 完整性验证、进度跟踪、并行队列
// ============================================================

import { useState, useCallback, DragEvent } from "react";
import { useParams, useNavigate } from "react-router-dom";
import type { TransferProgress, TransferStatus } from "../../../shared/types/index";
import { webrtcService } from "../services/webrtc";
import { wsService } from "../services/websocket";
import { fileTransferService } from "../services/fileTransfer";
import type { TransferCallbacks } from "../services/fileTransfer";
import { useTransferHistoryStore } from "../stores/transferHistoryStore";
import { useDeviceStore } from "../stores/deviceStore";
import ConfettiBurst from "../components/ConfettiBurst";

interface FileItem {
  id: string;
  file: globalThis.File;
  progress: TransferProgress;
  cancelFn?: () => void;
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
    setFiles((prev) => [...prev, ...newFiles].slice(0, 20));
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
    setFiles((prev) => {
      const item = prev.find((f) => f.id === fileId);
      if (item?.cancelFn) item.cancelFn();
      return prev.filter((f) => f.id !== fileId);
    });
  };

  /**
   * 更新单个文件的进度
   */
  const updateFileProgress = useCallback((progress: TransferProgress) => {
    setFiles((prev) =>
      prev.map((f) => {
        // 通过文件名匹配（同一文件可能被多次传输）
        if (f.file.name === progress.file_name && f.progress.status !== "completed") {
          return { ...f, progress };
        }
        return f;
      }),
    );
  }, []);

  /**
   * 获取目标设备名称
   */
  const getTargetDeviceName = useCallback(
    (targetId?: string): string => {
      const deviceIdToFind = targetId || deviceId || "";
      const { myDevices, pairedDevices } = useDeviceStore.getState();
      const allDevices = [...myDevices, ...pairedDevices];
      const device = allDevices.find((d) => d.id === deviceIdToFind);
      return device?.device_name || "未知设备";
    },
    [deviceId],
  );

  /**
   * 处理传输完成
   */
  const handleTransferComplete = useCallback(
    (
      fileId: string,
      fileName: string,
      success: boolean,
      fileSize?: number,
    ) => {
      setFiles((prev) =>
        prev.map((f) => {
          if (
            f.file.name === fileName &&
            f.progress.status !== "completed"
          ) {
            return {
              ...f,
              progress: {
                ...f.progress,
                file_id: fileId,
                status: success ? "completed" : ("failed" as TransferStatus),
                percentage: success ? 100 : f.progress.percentage,
              },
            };
          }
          return f;
        }),
      );

      // 记录传输历史
      const deviceName = getTargetDeviceName();
      const matchedFile = files.find((f) => f.file.name === fileName);
      const recordSize = fileSize || matchedFile?.file.size || 0;

      useTransferHistoryStore.getState().addRecord({
        id: `${fileId}-${Date.now()}`,
        fileName,
        fileSize: recordSize,
        deviceName,
        direction: "sent",
        timestamp: new Date().toISOString(),
        status: success ? "success" : "failed",
        sha256Match: success,
        errorMessage: success ? undefined : "传输失败",
      });
    },
    [files, getTargetDeviceName],
  );

  const startTransfer = async () => {
    if (!deviceId) return;

    setTransferring(true);
    setConnectionError(null);
    setConnectingDevice(deviceId);

    // 注册连接成功回调 — 启动文件传输
    webrtcService.setDataChannelReadyHandler((devId, dc) => {
      console.log(`✅ DataChannel ready for device ${devId}`);
      setConnectingDevice(null);

      // 为接收方向设置监听（接收文件时使用）
      const receiveCallbacks: TransferCallbacks = {
        onProgress: (progress) => updateFileProgress(progress),
        onComplete: (result) =>
          handleTransferComplete(
            result.file_id,
            result.file_name,
            result.success,
          ),
        onError: (fid, err) =>
          console.error(`接收文件错误 [${fid}]:`, err),
      };
      fileTransferService.setReceiveCallbacks(dc, receiveCallbacks);

      // 为每个待传输文件创建发送传输
      setFiles((prev) => {
        const pending = prev.filter(
          (f) => f.progress.status === "pending" || f.progress.status === "connecting",
        );

        if (pending.length === 0) {
          setTransferring(false);
          return prev;
        }

        return prev.map((f) => {
          if (
            f.progress.status !== "pending" &&
            f.progress.status !== "connecting"
          ) {
            return f;
          }

          // 创建传输回调
          const callbacks: TransferCallbacks = {
            onProgress: (progress) => updateFileProgress(progress),
            onComplete: (result) =>
              handleTransferComplete(
                result.file_id,
                result.file_name,
                result.success,
              ),
            onError: (fid, err) => {
              console.error(`发送文件错误 [${fid}]:`, err);
              handleTransferComplete(fid, f.file.name, false);
            },
          };

          // 启动发送
          const cancelFn = fileTransferService.sendFile(
            devId,
            f.file,
            dc,
            callbacks,
          );

          return {
            ...f,
            cancelFn,
            progress: { ...f.progress, status: "connecting" as TransferStatus },
          };
        });
      });
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

  const formatSpeed = (bps: number): string => {
    if (bps < 1024) return `${bps} B/s`;
    if (bps < 1024 * 1024) return `${(bps / 1024).toFixed(1)} KB/s`;
    return `${(bps / (1024 * 1024)).toFixed(1)} MB/s`;
  };

  const formatEta = (seconds: number): string => {
    if (seconds <= 0) return "--";
    if (seconds < 60) return `${seconds}秒`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}分${seconds % 60}秒`;
    return `${Math.floor(seconds / 3600)}时${Math.floor((seconds % 3600) / 60)}分`;
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

  const completedCount = files.filter(
    (f) => f.progress.status === "completed",
  ).length;
  const activeTransfers = files.filter(
    (f) =>
      f.progress.status === "transferring" ||
      f.progress.status === "verifying" ||
      f.progress.status === "connecting",
  ).length;

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
          opacity: transferring ? 0.6 : 1,
          pointerEvents: transferring ? "none" : "auto",
        }}
      >
        <div style={{ fontSize: 48, marginBottom: 12 }}>📁</div>
        <p style={{ fontSize: 15, fontWeight: 500 }}>拖拽文件到这里</p>
        <p style={{ fontSize: 13, color: "var(--color-text-secondary)", marginTop: 4 }}>
          或
        </p>
        <button
          className="btn-primary"
          onClick={handleFileSelect}
          style={{ marginTop: 8 }}
          disabled={transferring}
        >
          选择文件
        </button>
      </div>

      {/* 文件列表 */}
      {files.length > 0 && (
        <div>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: 8,
            }}
          >
            <h2 style={{ fontSize: 16, fontWeight: 600 }}>
              待传输文件（{files.length}）
            </h2>
            {activeTransfers > 0 && (
              <span style={{ fontSize: 12, color: "var(--color-primary)" }}>
                活跃: {activeTransfers} / 已完成: {completedCount}
              </span>
            )}
          </div>

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
                <span style={{ fontSize: 20 }}>
                  {item.progress.status === "completed"
                    ? "✅"
                    : item.progress.status === "failed"
                      ? "❌"
                      : item.progress.status === "transferring"
                        ? "📤"
                        : item.progress.status === "verifying"
                          ? "🔍"
                          : "📄"}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontWeight: 500,
                      fontSize: 14,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {item.file.name}
                  </div>
                  <div style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>
                    {formatSize(item.file.size)}
                    {item.progress.status === "transferring" &&
                      ` · ${formatSpeed(item.progress.speed_bps)} · 剩余 ${formatEta(item.progress.eta_seconds)}`}
                    {" · "}
                    <span style={{ color: getStatusColor(item.progress.status) }}>
                      {getStatusLabel(item.progress.status)}
                      {item.progress.status === "transferring" &&
                        ` ${item.progress.percentage}%`}
                    </span>
                  </div>
                  {(item.progress.status === "transferring" ||
                    item.progress.status === "verifying") && (
                    <div style={{ marginTop: 6 }}>
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
                            background:
                              item.progress.status === "verifying"
                                ? "var(--color-warning)"
                                : "var(--color-primary)",
                            transition: "width 0.3s ease",
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
                {(item.progress.status === "transferring" ||
                  item.progress.status === "connecting") && (
                  <button
                    className="btn-ghost"
                    onClick={() => removeFile(item.id)}
                    style={{ fontSize: 12, padding: "4px 8px", color: "var(--color-danger)" }}
                  >
                    取消
                  </button>
                )}
              </div>
            ))}
          </div>

          {connectingDevice && (
            <div
              style={{
                textAlign: "center",
                padding: "10px 0",
                fontSize: 13,
                color: "var(--color-primary)",
              }}
            >
              🔗 正在建立 P2P 加密直连...
            </div>
          )}
          {connectionError && (
            <div
              style={{
                textAlign: "center",
                padding: "10px 0",
                fontSize: 13,
                color: "var(--color-danger)",
              }}
            >
              ❌ {connectionError}
            </div>
          )}

          <button
            className="btn-primary"
            onClick={startTransfer}
            disabled={transferring}
            style={{ width: "100%", padding: 12, marginTop: 16 }}
          >
            {transferring
              ? activeTransfers > 0
                ? `传输中... (${completedCount}/${files.length})`
                : "准备传输..."
              : `开始传输 (${files.length} 个文件)`}
          </button>
        </div>
      )}

      {/* 传输完成粒子爆发动效 */}
      <ConfettiBurst trigger={completedCount} />
    </div>
  );
}
