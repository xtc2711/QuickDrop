// ============================================================
// 认证服务 — JWT 认证中间件
// 验证请求中的 Bearer Token
// ============================================================

import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { AppError } from "../utils/AppError.js";

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

export function authenticateToken(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    throw new AppError(401, "未提供认证 Token");
  }

  const token = authHeader.slice(7); // 去掉 "Bearer "
  const secret = process.env.JWT_ACCESS_SECRET || "dev-secret";

  try {
    const payload = jwt.verify(token, secret) as JwtPayload;
    req.user = payload;
    next();
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      throw new AppError(401, "Token 已过期，请刷新");
    }
    throw new AppError(401, "无效的 Token");
  }
}
