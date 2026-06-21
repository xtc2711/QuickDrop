// ============================================================
// 信令服务 — 设备在线管理
// 管理所有已连接设备的状态、心跳检测、上下线广播
// ============================================================

import type WebSocket from "ws";
import type { DeviceState } from "../models/types.js";

const HEARTBEAT_INTERVAL = parseInt(process.env.HEARTBEAT_INTERVAL_MS || "15000", 10);
const HEARTBEAT_TIMEOUT = parseInt(process.env.HEARTBEAT_TIMEOUT_MS || "30000", 10);

class DeviceManager {
  /** deviceId → DeviceState */
  private devices = new Map<string, DeviceState>();
  /** userId → Set<deviceId> */
  private userDevices = new Map<string, Set<string>>();

  private heartbeatTimer: NodeJS.Timeout | null = null;

  /**
   * 注册设备上线
   */
  register(device: DeviceState): void {
    this.devices.set(device.deviceId, device);

    // 维护用户设备索引
    if (!this.userDevices.has(device.userId)) {
      this.userDevices.set(device.userId, new Set());
    }
    this.userDevices.get(device.userId)!.add(device.deviceId);

    // 通知同账户其他在线设备
    this.broadcastToUser(device.userId, {
      type: "device_online",
      payload: {
        device_id: device.deviceId,
        device_name: device.deviceName,
        device_type: device.deviceType,
        os: device.os,
      },
      timestamp: new Date().toISOString(),
    }, device.deviceId);

    // 发送当前同账户在线设备列表给新设备
    const onlineDevices = this.getUserOnlineDevices(device.userId).filter(
      (d) => d.deviceId !== device.deviceId,
    );
    device.ws.send(
      JSON.stringify({
        type: "device_list_update",
        payload: {
          online_devices: onlineDevices.map((d) => ({
            device_id: d.deviceId,
            device_name: d.deviceName,
            device_type: d.deviceType,
            os: d.os,
          })),
        },
        timestamp: new Date().toISOString(),
      }),
    );

    // 启动心跳检测（首次注册时）
    if (!this.heartbeatTimer) {
      this.startHeartbeat();
    }
  }

  /**
   * 设备离线
   */
  unregister(deviceId: string): void {
    const device = this.devices.get(deviceId);
    if (!device) return;

    this.devices.delete(deviceId);

    const userDeviceSet = this.userDevices.get(device.userId);
    if (userDeviceSet) {
      userDeviceSet.delete(deviceId);
      if (userDeviceSet.size === 0) {
        this.userDevices.delete(device.userId);
      }
    }

    // 通知同账户其他设备
    this.broadcastToUser(device.userId, {
      type: "device_offline",
      payload: { device_id: deviceId },
      timestamp: new Date().toISOString(),
    }, deviceId);

    // 清理心跳定时器
    if (this.devices.size === 0 && this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  /**
   * 获取设备信息
   */
  get(deviceId: string): DeviceState | undefined {
    return this.devices.get(deviceId);
  }

  /**
   * 获取用户的所有在线设备
   */
  getUserOnlineDevices(userId: string): DeviceState[] {
    const deviceSet = this.userDevices.get(userId);
    if (!deviceSet) return [];
    return Array.from(deviceSet)
      .map((id) => this.devices.get(id))
      .filter((d): d is DeviceState => d !== undefined);
  }

  /**
   * 给指定用户的所有在线设备广播消息
   * @param excludeDeviceId 排除的设备 ID（不给发送方自己发）
   */
  broadcastToUser(
    userId: string,
    message: unknown,
    excludeDeviceId?: string,
  ): void {
    const devices = this.getUserOnlineDevices(userId);
    const data = JSON.stringify(message);

    for (const device of devices) {
      if (excludeDeviceId && device.deviceId === excludeDeviceId) continue;
      if (device.ws.readyState === device.ws.OPEN) {
        device.ws.send(data);
      }
    }
  }

  /**
   * 给指定设备发送消息
   */
  sendToDevice(deviceId: string, message: unknown): boolean {
    const device = this.devices.get(deviceId);
    if (!device || device.ws.readyState !== device.ws.OPEN) return false;
    device.ws.send(JSON.stringify(message));
    return true;
  }

  /**
   * 更新心跳时间
   */
  heartbeat(deviceId: string): void {
    const device = this.devices.get(deviceId);
    if (device) {
      device.lastHeartbeat = new Date();
      device.isAlive = true;
    }
  }

  /**
   * 心跳检测：定时检查所有连接，超时断开
   */
  private startHeartbeat(): void {
    this.heartbeatTimer = setInterval(() => {
      const now = Date.now();
      for (const [deviceId, device] of this.devices) {
        if (now - device.lastHeartbeat.getTime() > HEARTBEAT_TIMEOUT) {
          console.log(`💔 Device ${deviceId} heartbeat timeout, disconnecting`);
          device.ws.terminate();
          this.unregister(deviceId);
        }
      }
    }, HEARTBEAT_INTERVAL);
  }

  /**
   * 获取在线设备总数
   */
  get onlineCount(): number {
    return this.devices.size;
  }

  /**
   * 获取按用户分组的在线设备统计
   * 供管理后台和监控使用
   */
  getStatsByUser(): { total_users: number; devices_per_user: Record<string, number> } {
    const perUser: Record<string, number> = {};
    for (const [userId, deviceSet] of this.userDevices) {
      perUser[userId] = deviceSet.size;
    }
    return { total_users: this.userDevices.size, devices_per_user: perUser };
  }
}

// 导出类和单例（类导出供测试使用）
export { DeviceManager };
export const deviceManager = new DeviceManager();
