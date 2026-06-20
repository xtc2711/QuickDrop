// ============================================================
// 信令服务 — WebSocket JWT 认证中间件
// 从 URL query string 或 Sec-WebSocket-Protocol 中提取 Token 并验证
// ============================================================

import type { IncomingMessage } from "http";
import jwt from "jsonwebtoken";

export interface WsJwtPayload {
  sub: string; // user_id
  device_id: string;
  jti: string;
  iat: number;
  exp: number;
}

/**
 * 从 WebSocket 升级请求中认证 JWT Token
 * Token 来源优先级: query string `?token=xxx` > header `Sec-WebSocket-Protocol`
 */
export function authenticateWebSocket(req: IncomingMessage): WsJwtPayload | null {
  const secret = process.env.JWT_ACCESS_SECRET || "quickdrop-access-dev-secret";

  // 1. 从 query string 获取
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  let token = url.searchParams.get("token");

  // 2. 从 Sec-WebSocket-Protocol header 获取（客户端可用此 header 传 Token）
  if (!token) {
    const protocol = req.headers["sec-websocket-protocol"];
    if (protocol) {
      const protocols = protocol.split(",").map((p) => p.trim());
      // 寻找以 "access_token." 为前缀的协议
      const tokenProtocol = protocols.find((p) => p.startsWith("access_token."));
      if (tokenProtocol) {
        token = tokenProtocol.slice("access_token.".length);
      }
    }
  }

  if (!token) return null;

  try {
    const payload = jwt.verify(token, secret) as WsJwtPayload;
    return payload;
  } catch {
    return null;
  }
}
