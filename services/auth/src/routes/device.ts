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
 * 远程移除设备
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
      res.json({ message: "设备已移除" });
    } catch (err) {
      next(err);
    }
  },
);
