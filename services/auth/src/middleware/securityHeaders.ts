// ============================================================
// 认证服务 — 安全头部中间件
// HTTPS 强制、HSTS、安全响应头
// ============================================================

import type { Request, Response, NextFunction } from "express";

/**
 * 判断是否为生产环境
 */
function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

/**
 * HTTPS 强制重定向中间件
 * 生产环境下将 HTTP 请求 301 重定向到 HTTPS
 * 排除健康检查端点
 */
export function httpsRedirect(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (!isProduction()) {
    next();
    return;
  }

  // 已通过反向代理的 HTTPS（检查 X-Forwarded-Proto 头）
  const proto = req.headers["x-forwarded-proto"];
  if (proto && proto !== "https") {
    const httpsUrl = `https://${req.headers.host}${req.originalUrl}`;
    res.redirect(301, httpsUrl);
    return;
  }

  next();
}

/**
 * HSTS (HTTP Strict Transport Security) 中间件
 * 告知浏览器只能通过 HTTPS 访问，有效期 1 年
 * 仅在 HTTPS 连接上设置（避免在 HTTP 上设置被忽略）
 */
export function hsts(
  _req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (isProduction()) {
    res.setHeader(
      "Strict-Transport-Security",
      "max-age=31536000; includeSubDomains; preload",
    );
  }
  next();
}

/**
 * 通用安全响应头中间件
 * 防止 XSS、MIME 嗅探、点击劫持等常见攻击
 */
export function securityHeaders(
  _req: Request,
  res: Response,
  next: NextFunction,
): void {
  // 防止 MIME 类型嗅探
  res.setHeader("X-Content-Type-Options", "nosniff");

  // 防止点击劫持
  res.setHeader("X-Frame-Options", "DENY");

  // XSS 过滤保护
  res.setHeader("X-XSS-Protection", "1; mode=block");

  // 引用策略
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");

  // 限制浏览器功能权限
  if (isProduction()) {
    res.setHeader(
      "Permissions-Policy",
      "camera=(), microphone=(), geolocation=()",
    );
  }

  // CSP 内容安全策略
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' https: wss:;",
  );

  next();
}
