// ============================================================
// QuickDrop 共享类型定义
// 被认证服务、信令服务和客户端共同引用
// ============================================================

// ---------- 用户与认证 ----------

export interface User {
  id: string;
  email: string;
  createdAt: Date;
  updatedAt: Date;
  isLocked: boolean;
  lockedUntil: Date | null;
  failedLoginAttempts: number;
}

export interface RegisterRequest {
  email: string;
  password: string;
  device_name: string;
  device_type: DeviceType;
  os: OperatingSystem;
}

export interface LoginRequest {
  email: string;
  password: string;
  device_name: string;
  device_type: DeviceType;
  os: OperatingSystem;
  remember_device?: boolean;
}

export interface TokenPair {
  access_token: string;
  refresh_token: string;
  expires_in: number; // Access Token 有效期（秒）
}

export interface AuthResponse {
  user: PublicUser;
  tokens: TokenPair;
  device: DeviceInfo;
}

export interface PublicUser {
  id: string;
  email: string;
  created_at: string;
}

// ---------- 设备 ----------

export type DeviceType = "desktop" | "phone" | "tablet";
export type OperatingSystem = "windows" | "macos" | "android" | "ios";

export interface DeviceInfo {
  id: string;
  device_name: string;
  device_type: DeviceType;
  os: OperatingSystem;
  is_online: boolean;
  first_seen: string;
  last_seen: string;
  is_current?: boolean;
}

export interface DeviceListResponse {
  my_devices: DeviceInfo[];
  paired_devices: DeviceInfo[];
}

// ---------- 配对 ----------

export interface PairingCodeResponse {
  code: string;
  expires_in: number; // 秒
  room_id: string;
}

export interface PairingQRResponse {
  qr_data: string; // 二维码内容（包含连接信息）
  expires_in: number;
  room_id: string;
}

export interface PairingJoinRequest {
  code: string;
  device_name: string;
  device_type: DeviceType;
  os: OperatingSystem;
}

// ---------- WebSocket 消息 ----------

export type WsMessageType =
  // 设备管理
  | "device_online"
  | "device_offline"
  | "device_list_update"
  | "force_logout"
  // 信令
  | "offer"
  | "answer"
  | "ice_candidate"
  | "peer_join"
  | "peer_leave"
  // 系统
  | "ping"
  | "pong"
  | "error";

export interface WsMessage {
  type: WsMessageType;
  payload: unknown;
  timestamp: string;
}

export interface WsDeviceOnlinePayload {
  device: DeviceInfo;
}

export interface WsDeviceOfflinePayload {
  device_id: string;
}

export interface WsSignalingPayload {
  from_device_id: string;
  to_device_id: string;
  data: unknown; // SDP 或 ICE candidate
}

// ---------- 文件传输 ----------

export interface FileChunk {
  file_id: string;
  chunk_index: number;
  total_chunks: number;
  data: ArrayBuffer;
  crc32: number;
}

export interface FileMetadata {
  file_id: string;
  file_name: string;
  file_size: number;
  mime_type: string;
  total_chunks: number;
  chunk_size: number; // 固定 16KB = 16384
  sha256?: string; // 发送端预计算
}

export interface TransferProgress {
  file_id: string;
  file_name: string;
  total_bytes: number;
  transferred_bytes: number;
  percentage: number;
  speed_bps: number; // 字节/秒
  eta_seconds: number;
  status: TransferStatus;
}

export type TransferStatus =
  | "pending"
  | "connecting"
  | "transferring"
  | "verifying"
  | "completed"
  | "failed"
  | "cancelled";

export interface TransferResult {
  file_id: string;
  file_name: string;
  success: boolean;
  sha256_match: boolean;
  retry_count: number;
  error_message?: string;
}

// ---------- 连接通道 ----------

export type ConnectionChannel = "bluetooth" | "lan_p2p" | "turn_relay";

export interface ConnectionInfo {
  channel: ConnectionChannel;
  device_id: string;
  established_at: string;
  latency_ms: number;
}
