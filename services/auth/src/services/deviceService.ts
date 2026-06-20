// ============================================================
// 认证服务 — 设备管理服务
// ============================================================

import { PrismaClient } from "@prisma/client";
import type { DeviceInfo, DeviceListResponse } from "../../../../shared/types/index.js";
import { AppError } from "../utils/AppError.js";

const prisma = new PrismaClient();

export class DeviceService {
  /**
   * 获取用户所有设备列表
   */
  async listUserDevices(userId: string): Promise<DeviceListResponse> {
    const devices = await prisma.device.findMany({
      where: { userId, isActive: true },
      orderBy: { lastSeen: "desc" },
    });

    const deviceInfos: DeviceInfo[] = devices.map((d) => ({
      id: d.id,
      device_name: d.deviceName,
      device_type: d.deviceType as "desktop" | "phone" | "tablet",
      os: d.os as "windows" | "macos" | "android" | "ios",
      is_online: d.isOnline,
      first_seen: d.firstSeen.toISOString(),
      last_seen: d.lastSeen.toISOString(),
    }));

    // 返回所有活跃设备（含在线和离线），按在线优先 + 最后活跃时间排序
    return {
      my_devices: deviceInfos.sort((a, b) => {
        if (a.is_online !== b.is_online) return a.is_online ? -1 : 1;
        return new Date(b.last_seen).getTime() - new Date(a.last_seen).getTime();
      }),
      paired_devices: [], // 临时配对设备由信令服务管理
    };
  }

  /**
   * 远程移除设备
   * 撤销该设备的 Refresh Token，标记设备为离线
   */
  async removeDevice(userId: string, deviceId: string): Promise<void> {
    const device = await prisma.device.findUnique({ where: { id: deviceId } });

    if (!device || device.userId !== userId) {
      throw new AppError(404, "设备不存在或无权操作");
    }

    // 撤销 Token
    await prisma.refreshToken.updateMany({
      where: { deviceId, revoked: false },
      data: { revoked: true },
    });

    // 标记设备离线且不活跃
    await prisma.device.update({
      where: { id: deviceId },
      data: { isOnline: false, isActive: false },
    });
  }
}
