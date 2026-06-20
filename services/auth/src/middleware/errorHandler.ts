// ============================================================
// 认证服务 — 全局错误处理中间件
// ============================================================

import type { Request, Response, NextFunction } from "express";
import { AppError } from "../utils/AppError.js";

export function errorHandler(
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      error: {
        code: err.statusCode,
        message: err.message,
        details: err.details,
      },
    });
    return;
  }

  // 未知错误
  console.error("Unhandled error:", err);
  res.status(500).json({
    error: {
      code: 500,
      message: "服务器内部错误",
    },
  });
}
