// ============================================================
// 认证服务 — 路由: /api/v1/admin
// 管理后台 API（需要 Admin 权限）
// ============================================================

import { Router } from "express";
import type { Request, Response, NextFunction } from "express";
import { authenticateToken } from "../middleware/authMiddleware.js";
import { requireAdmin } from "../middleware/adminMiddleware.js";
import { AdminService } from "../services/adminService.js";
import { AppError } from "../utils/AppError.js";

export const adminRouter = Router();

const adminService = new AdminService();

// 所有 Admin 路由都需要认证 + Admin 权限
adminRouter.use(authenticateToken);
adminRouter.use(requireAdmin);

/**
 * GET /api/v1/admin/stats
 * 获取仪表盘统计数据
 */
adminRouter.get(
  "/stats",
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const stats = await adminService.getDashboardStats();
      res.json(stats);
    } catch (err) {
      next(err);
    }
  },
);

/**
 * GET /api/v1/admin/users
 * 获取用户列表（支持分页、搜索、筛选）
 *
 * Query params:
 *   page: number (default 1)
 *   page_size: number (default 20, max 100)
 *   search: string (email search)
 *   is_locked: boolean
 *   is_admin: boolean
 */
adminRouter.get(
  "/users",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const page = Math.max(1, parseInt(req.query.page as string) || 1);
      const pageSize = Math.min(
        100,
        Math.max(1, parseInt(req.query.page_size as string) || 20),
      );
      const search = req.query.search as string | undefined;
      const filters: { is_locked?: boolean; is_admin?: boolean } = {};

      if (req.query.is_locked !== undefined) {
        filters.is_locked = req.query.is_locked === "true";
      }
      if (req.query.is_admin !== undefined) {
        filters.is_admin = req.query.is_admin === "true";
      }

      const result = await adminService.listUsers(page, pageSize, search, filters);
      res.json(result);
    } catch (err) {
      next(err);
    }
  },
);

/**
 * GET /api/v1/admin/users/:id
 * 获取用户详情（含设备列表）
 */
adminRouter.get(
  "/users/:id",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = req.params.id as string;
      const user = await adminService.getUserDetail(userId);
      res.json(user);
    } catch (err) {
      next(err);
    }
  },
);

/**
 * POST /api/v1/admin/users/:id/lock
 * 切换用户锁定状态
 */
adminRouter.post(
  "/users/:id/lock",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await adminService.toggleUserLock(req.params.id as string);
      res.json({
        message: result.is_locked ? "用户已锁定" : "用户已解锁",
        ...result,
      });
    } catch (err) {
      next(err);
    }
  },
);

/**
 * POST /api/v1/admin/users/:id/admin
 * 切换用户管理员状态
 */
adminRouter.post(
  "/users/:id/admin",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await adminService.toggleAdmin(req.params.id as string);
      res.json({
        message: result.is_admin ? "已授予管理员权限" : "已撤销管理员权限",
        ...result,
      });
    } catch (err) {
      next(err);
    }
  },
);

/**
 * DELETE /api/v1/admin/users/:id
 * 删除用户（级联删除设备、Token 等）
 */
adminRouter.delete(
  "/users/:id",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      await adminService.deleteUser(req.params.id as string);
      res.json({ message: "用户已删除" });
    } catch (err) {
      next(err);
    }
  },
);

/**
 * GET /api/v1/admin/devices
 * 获取所有设备列表（支持分页、搜索、筛选）
 */
adminRouter.get(
  "/devices",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const page = Math.max(1, parseInt(req.query.page as string) || 1);
      const pageSize = Math.min(
        100,
        Math.max(1, parseInt(req.query.page_size as string) || 20),
      );
      const search = req.query.search as string | undefined;
      const filters: { is_online?: boolean } = {};

      if (req.query.is_online !== undefined) {
        filters.is_online = req.query.is_online === "true";
      }

      const result = await adminService.listDevices(page, pageSize, search, filters);
      res.json(result);
    } catch (err) {
      next(err);
    }
  },
);

/**
 * DELETE /api/v1/admin/devices/:id
 * 强制移除设备
 */
adminRouter.delete(
  "/devices/:id",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      await adminService.forceRemoveDevice(req.params.id as string);
      res.json({ message: "设备已强制移除" });
    } catch (err) {
      next(err);
    }
  },
);
