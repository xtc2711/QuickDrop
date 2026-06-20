// ============================================================
// 认证服务 — JWT 认证中间件
// 验证请求中的 Bearer Token
// ============================================================

import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { AppError } from "../utils/AppError.js";
import { isBlacklisted } from "../services/blacklistService.js";

declare global {
  namespace Express {
    interface Request {
      user?: JwtPayload;
    }
  }
}

export interface JwtPayload {
  sub: string; // user_id
  device_id: string;
  jti: string; // token unique id
  iat: number;
  exp: number;
}

/**
 * JWT 认证中间件
 * 1. 校验 Bearer Token 格式
 * 2. 验证 JWT 签名和有效期
 * 3. 检查 Token 是否在黑名单中（已退出登录）
 */
export function authenticateToken(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    next(new AppError(401, "未提供认证 Token"));
    return;
  }

  const token = authHeader.slice(7);
  const secret = process.env.JWT_ACCESS_SECRET || "quickdrop-access-dev-secret";

  let payload: JwtPayload;
  try {
    payload = jwt.verify(token, secret) as JwtPayload;
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      next(new AppError(401, "Token 已过期，请刷新"));
      return;
    }
    next(new AppError(401, "无效的 Token"));
    return;
  }

  // 检查 Token 黑名单
  isBlacklisted(payload.jti)
    .then((blacklisted) => {
      if (blacklisted) {
        next(new AppError(401, "Token 已失效，请重新登录"));
        return;
      }
      req.user = payload;
      next();
    })
    .catch((err) => {
      // 黑名单服务不可用时降级放行（记录警告）
      console.warn(
        "⚠️  Token 黑名单检查失败，降级放行:",
        (err as Error).message,
      );
      req.user = payload;
      next();
    });
}
