// ============================================================
// 认证服务 — Admin 权限中间件
// 验证请求用户是否具有管理员权限
// 必须在 authenticateToken 之后使用
// ============================================================

import type { Request, Response, NextFunction } from "express";
import { PrismaClient } from "@prisma/client";
import { AppError } from "../utils/AppError.js";

const prisma = new PrismaClient();

export function requireAdmin(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  const userId = req.user?.sub;
  if (!userId) {
    next(new AppError(401, "未提供认证 Token"));
    return;
  }

  prisma.user
    .findUnique({ where: { id: userId }, select: { isAdmin: true } })
    .then((user) => {
      if (!user) {
        next(new AppError(404, "用户不存在"));
        return;
      }

      if (!user.isAdmin) {
        next(new AppError(403, "需要管理员权限"));
        return;
      }

      // 附加 is_admin 标记到请求对象
      if (req.user) {
        req.user.is_admin = true;
      }
      next();
    })
    .catch((err) => {
      console.error("Admin 权限检查失败:", err);
      next(new AppError(500, "权限校验服务异常"));
    });
}
