// ============================================================
// 认证服务 — 路由: /api/v1/devices
// ============================================================

import { Router } from "express";
import type { Request, Response, NextFunction } from "express";
import { authenticateToken } from "../middleware/authMiddleware.js";
import { DeviceService } from "../services/deviceService.js";
import { AppError } from "../utils/AppError.js";

export const deviceRouter = Router();

const deviceService = new DeviceService();

/** 信令服务地址 */
const SIGNAL_SERVICE_URL = process.env.SIGNAL_SERVICE_URL || "http://localhost:3002";

/**
 * 通知信令服务强制下线设备
 */
async function notifyForceLogout(deviceId: string): Promise<void> {
  try {
    await fetch(`${SIGNAL_SERVICE_URL}/force-logout`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ device_id: deviceId }),
    });
  } catch (err) {
    // 信令服务不可用时静默失败，不影响移除操作
    console.warn(`Failed to notify signal service for force logout of device ${deviceId}:`, err);
  }
}

/**
 * GET /api/v1/devices
 * 获取当前用户的所有设备列表
 */
deviceRouter.get(
  "/",
  authenticateToken,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const devices = await deviceService.listUserDevices(req.user!.sub);
      res.json(devices);
    } catch (err) {
      next(err);
    }
  },
);

/**
 * DELETE /api/v1/devices/:deviceId
 * 远程移除设备（撤销 Token + 强制下线推送）
 */
deviceRouter.delete(
  "/:deviceId",
  authenticateToken,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const deviceId = Array.isArray(req.params.deviceId)
        ? req.params.deviceId[0]
        : req.params.deviceId;
      await deviceService.removeDevice(req.user!.sub, deviceId);

      // 通知信令服务推送 force_logout（异步，不阻塞响应）
      notifyForceLogout(deviceId);

      res.json({ message: "设备已移除" });
    } catch (err) {
      next(err);
    }
  },
);
