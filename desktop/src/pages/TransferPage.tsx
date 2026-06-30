// ============================================================
// 桌面客户端 — 文件传输页面（单文件逐个传输）
// ============================================================

import { useState, useCallback, useRef, DragEvent } from "react";
import { useParams, useNavigate } from "react-router-dom";
import type { TransferProgress, TransferStatus, ConnectionChannel } from "../../../shared/types/index";
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

  const [file, setFile] = useState<FileItem | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [transferring, setTransferring] = useState(false);
  const [connectingDevice, setConnectingDevice] = useState<string | null>(null);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [channelInfo, setChannelInfo] = useState<{ channel: ConnectionChannel; rttMs?: number } | null>(null);
  const transferDoneRef = useRef(false);

  // ---- 文件选择（单文件，替换而非累积） ----

  const selectFile = useCallback((f: globalThis.File) => {
    // 取消之前可能正在传输的文件
    if (file?.cancelFn) file.cancelFn();
    setFile({
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      file: f,
      progress: {
        file_id: "", file_name: f.name, total_bytes: f.size,
        transferred_bytes: 0, percentage: 0, speed_bps: 0,
        eta_seconds: 0, status: "pending" as TransferStatus,
      },
    });
    transferDoneRef.current = false;
    setConnectionError(null);
  }, [file]);

  const handleDragOver = (e: DragEvent) => { e.preventDefault(); setIsDragOver(true); };
  const handleDragLeave = (e: DragEvent) => { e.preventDefault(); setIsDragOver(false); };
  const handleDrop = (e: DragEvent) => {
    e.preventDefault(); setIsDragOver(false);
    if (e.dataTransfer.files.length > 0) selectFile(e.dataTransfer.files[0]);
  };

  const handleFileSelect = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.onchange = () => { if (input.files?.length) selectFile(input.files[0]); };
    input.click();
  };

  const removeFile = () => {
    if (file?.cancelFn) file.cancelFn();
    transferDoneRef.current = false;
    setFile(null);
  };

  // ---- 进度与完成处理 ----

  const updateProgress = useCallback((progress: TransferProgress) => {
    setFile((prev) => prev && prev.file.name === progress.file_name
      ? { ...prev, progress }
      : prev
    );
  }, []);

  const getTargetDeviceName = useCallback((targetId?: string): string => {
    const id = targetId || deviceId || "";
    const { myDevices, pairedDevices } = useDeviceStore.getState();
    return [...myDevices, ...pairedDevices].find((d) => d.id === id)?.device_name || "未知设备";
  }, [deviceId]);

  const handleTransferComplete = useCallback((
    fileId: string, fileName: string, success: boolean, fileSize?: number,
  ) => {
    setFile((prev) => {
      if (!prev || prev.file.name !== fileName) return prev;
      return {
        ...prev,
        progress: {
          ...prev.progress,
          file_id: fileId,
          status: success ? "completed" : "failed" as TransferStatus,
          percentage: success ? 100 : prev.progress.percentage,
        },
      };
    });
    const deviceName = getTargetDeviceName();
    useTransferHistoryStore.getState().addRecord({
      id: `${fileId}-${Date.now()}`, fileName, fileSize: fileSize || file?.file.size || 0,
      deviceName, direction: "sent", timestamp: new Date().toISOString(),
      status: success ? "success" : "failed", sha256Match: success,
      errorMessage: success ? undefined : "传输失败",
      filePath: (file?.file as any)?.path || undefined,
    } as any);
  }, [file, getTargetDeviceName]);

  // ---- 发起传输（单文件顺序） ----

  const startTransfer = async () => {
    if (!deviceId || !file) return;
    setTransferring(true); setConnectionError(null); setConnectingDevice(deviceId);

    webrtcService.setDataChannelReadyHandler(async (_devId, dc) => {
      setConnectingDevice(null);
      const receiveCallbacks: TransferCallbacks = {
        onProgress: (p) => updateProgress(p),
        onComplete: (r) => handleTransferComplete(r.file_id, r.file_name, r.success),
        onError: (fid, err) => console.error(`接收错误 [${fid}]:`, err),
      };
      fileTransferService.setReceiveCallbacks(dc, receiveCallbacks);

      // 单文件发送：等待完成
      const currentFile = file;
      if (!currentFile || currentFile.progress.status === "completed") {
        setTransferring(false);
        return;
      }

      await new Promise<void>((resolve) => {
        const callbacks: TransferCallbacks = {
          onProgress: (p) => updateProgress(p),
          onComplete: (r) => {
            transferDoneRef.current = true;
            handleTransferComplete(r.file_id, r.file_name, r.success);
            resolve();
          },
          onError: (fid, err) => {
            console.error(`发送错误 [${fid}]:`, err);
            handleTransferComplete(fid, currentFile.file.name, false);
            resolve();
          },
        };
        const cancelFn = fileTransferService.sendFile(_devId, currentFile.file, dc, callbacks);
        setFile((prev) => prev ? { ...prev, cancelFn, progress: { ...prev.progress, status: "connecting" as TransferStatus } } : prev);
      });

      setTransferring(false);
    });

    // 通道信息显示
    webrtcService.setChannelChangeHandler((_devId, channel) => {
      if (_devId === deviceId) {
        const peerState = webrtcService.getPeerState(deviceId);
        setChannelInfo({ channel, rttMs: peerState?.rttMs });
      }
    });

    webrtcService.setConnectionChangeHandler((_devId, state) => {
      if (state === "failed") {
        if (!transferDoneRef.current) setConnectionError("连接设备失败，请检查对方是否在线后重试");
        setTransferring(false); setConnectingDevice(null);
      }
      if (state === "connected") setConnectingDevice(null);
      // 传输中短暂断连可能是 ICE 重连，不立即报错
      if (state === "disconnected" && !transferDoneRef.current && !connectingDevice) {
        setConnectionError("设备连接已断开");
        setTransferring(false);
      }
    });

    try {
      await webrtcService.createOffer(deviceId, (msg) => wsService.send(msg.type, msg.payload, msg.target));
    } catch (err) {
      console.error("Failed to create WebRTC offer:", err);
      setConnectionError("创建 P2P 连接失败，请重试"); setTransferring(false); setConnectingDevice(null);
    }
  };

  // ---- 格式化工具 ----

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
    return `${Math.floor(seconds / 60)}分${seconds % 60}秒`;
  };

  const getStatusLabel = (s: TransferStatus): string =>
    ({ pending: "等待发送", connecting: "连接中", transferring: "传输中", verifying: "校验中", completed: "已完成", failed: "失败", cancelled: "已取消" }[s]);

  const getStatusClass = (s: TransferStatus): string => {
    if (s === "completed") return "badge-success";
    if (s === "failed" || s === "cancelled") return "badge-danger";
    if (s === "transferring" || s === "verifying") return "badge-info";
    return "";
  };

  const targetDevice = (() => {
    if (!deviceId) return null;
    const { myDevices, pairedDevices } = useDeviceStore.getState();
    return [...myDevices, ...pairedDevices].find((d) => d.id === deviceId);
  })();

  const isDone = file?.progress.status === "completed" || file?.progress.status === "failed";

  return (
    <div>
      {/* 页面头部 */}
      <div className="page-header">
        <div>
          <h1 className="page-title">文件传输</h1>
          <p className="page-subtitle">
            发送至 {targetDevice?.device_name || "..."}
            <span style={{ margin: "0 6px" }}>·</span>
            {targetDevice?.os}
            {channelInfo && (
              <>
                <span style={{ margin: "0 6px" }}>·</span>
                <span className={`channel-badge channel-${channelInfo.channel === "lan_p2p" ? "lan" : "relay"}`}>
                  {channelInfo.channel === "lan_p2p" ? "局域网" : "中继"}
                </span>
                {channelInfo.rttMs !== undefined && (
                  <span style={{ marginLeft: 4, fontSize: 11, color: "var(--color-text-secondary)" }}>
                    {channelInfo.rttMs}ms
                  </span>
                )}
              </>
            )}
          </p>
        </div>
        <button className="btn-ghost" onClick={() => navigate("/devices")} style={{ padding: "6px 14px" }}>
          ← 返回设备列表
        </button>
      </div>

      <div className="two-column">
        {/* 左栏：拖拽区 + 文件信息 */}
        <div>
          <div
            onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop}
            style={{
              border: `2px dashed ${isDragOver ? "var(--color-primary)" : "var(--color-border)"}`,
              borderRadius: "var(--radius-lg)", padding: "40px 20px", textAlign: "center",
              background: isDragOver ? "var(--color-primary-light)" : "var(--color-surface)",
              transition: "all 0.2s", marginBottom: 16,
              opacity: transferring ? 0.6 : 1, pointerEvents: transferring ? "none" : "auto",
            }}
          >
            <div style={{ fontSize: 40, marginBottom: 8 }}>📁</div>
            <p style={{ fontSize: 14, fontWeight: 500, margin: 0 }}>拖拽文件到这里</p>
            <p style={{ fontSize: 12, color: "var(--color-text-secondary)", marginTop: 4 }}>或</p>
            <button
              className="btn-primary" onClick={handleFileSelect}
              style={{ marginTop: 8 }}
              disabled={transferring}
            >
              选择文件
            </button>
          </div>

          {file && (
            <div className="card" style={{ padding: 0 }}>
              <div style={{
                display: "flex", alignItems: "center", padding: "14px 16px", gap: 12,
              }}>
                <span style={{ fontSize: 24 }}>
                  {file.progress.status === "completed" ? "✅" :
                   file.progress.status === "failed" ? "❌" :
                   file.progress.status === "transferring" ? "📤" :
                   file.progress.status === "verifying" ? "🔍" : "📄"}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 14, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {file.file.name}
                  </div>
                  <div style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>
                    {formatSize(file.file.size)}
                    {file.progress.status === "transferring" && ` · ${formatSpeed(file.progress.speed_bps)} · 剩余 ${formatEta(file.progress.eta_seconds)}`}
                    {file.progress.status === "verifying" && " · 校验中..."}
                    {" · "}
                    <span className={`badge ${getStatusClass(file.progress.status)}`}>
                      {getStatusLabel(file.progress.status)}
                      {(file.progress.status === "transferring" || file.progress.status === "verifying") && ` ${file.progress.percentage}%`}
                    </span>
                  </div>
                  {(file.progress.status === "transferring" || file.progress.status === "verifying") && (
                    <div className="progress-bar" style={{ marginTop: 8 }}>
                      <div
                        className="progress-bar-fill"
                        style={{
                          width: `${file.progress.percentage}%`,
                          background: file.progress.status === "verifying" ? "var(--color-warning)" : "var(--color-primary)",
                        }}
                      />
                    </div>
                  )}
                </div>
                {/* 取消/移除按钮 */}
                {!transferring && (
                  <button className="btn-ghost" onClick={removeFile} style={{ fontSize: 14, padding: "4px 8px" }}>
                    {isDone ? "清除" : "✕"}
                  </button>
                )}
                {transferring && !isDone && (
                  <button className="btn-ghost btn-sm" onClick={removeFile} style={{ color: "var(--color-danger)" }}>
                    取消
                  </button>
                )}
              </div>
            </div>
          )}

          {file && !isDone && (
            <button className="btn-primary" onClick={startTransfer} disabled={transferring}
              style={{ width: "100%", padding: 12, marginTop: 16 }}>
              {transferring
                ? (file.progress.status === "connecting" ? "正在建立连接..." : "传输中...")
                : "开始传输"}
            </button>
          )}
        </div>

        {/* 右栏：连接状态 */}
        <div>
          <div className="card" style={{ position: "sticky", top: 32 }}>
            <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 16 }}>连接状态</h3>

            {connectingDevice && (
              <div className="alert alert-info" style={{ fontSize: 13 }}>
                🔗 正在建立 P2P 加密直连...
              </div>
            )}
            {connectionError && (
              <div className="alert alert-error" style={{ fontSize: 13 }}>
                ❌ {connectionError}
              </div>
            )}
            {channelInfo && (
              <div style={{ marginTop: 12, fontSize: 13, color: "var(--color-text-secondary)" }}>
                <strong>传输通道：</strong>
                <span className={`channel-badge channel-${channelInfo.channel === "lan_p2p" ? "lan" : "relay"}`} style={{ marginLeft: 6 }}>
                  {channelInfo.channel === "lan_p2p" ? "局域网 P2P" : "TURN 中继"}
                </span>
                {channelInfo.rttMs !== undefined && (
                  <div style={{ marginTop: 6 }}>延迟：{channelInfo.rttMs}ms</div>
                )}
              </div>
            )}

            {!connectingDevice && !connectionError && !file && (
              <div style={{ textAlign: "center", padding: "20px 0", color: "var(--color-text-muted)", fontSize: 13 }}>
                <div style={{ fontSize: 36, marginBottom: 8 }}>📤</div>
                拖拽文件或点击「选择文件」开始传输
              </div>
            )}

            {file && (
              <div style={{ marginTop: 12, fontSize: 13 }}>
                <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0" }}>
                  <span>文件名</span>
                  <span style={{ maxWidth: 150, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {file.file.name}
                  </span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0" }}>
                  <span>大小</span>
                  <span>{formatSize(file.file.size)}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0" }}>
                  <span>状态</span>
                  <span className={`badge ${getStatusClass(file.progress.status)}`}>
                    {getStatusLabel(file.progress.status)}
                  </span>
                </div>
                {(file.progress.status === "transferring" || file.progress.status === "verifying") && (
                  <>
                    <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0" }}>
                      <span>速度</span>
                      <span>{formatSpeed(file.progress.speed_bps)}</span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0" }}>
                      <span>剩余时间</span>
                      <span>{formatEta(file.progress.eta_seconds)}</span>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      <ConfettiBurst trigger={isDone ? 1 : 0} />
    </div>
  );
}
