// ============================================================
// 认证服务 — JWT Token 工具
// ============================================================

import jwt from "jsonwebtoken";
import { v4 as uuidv4 } from "uuid";

export interface TokenPayload {
  sub: string; // user_id
  device_id: string;
  jti: string; // unique token id
}

export interface TokenPair {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

function getAccessSecret(): string {
  return process.env.JWT_ACCESS_SECRET || "quickdrop-access-dev-secret";
}

function getRefreshSecret(): string {
  return process.env.JWT_REFRESH_SECRET || "quickdrop-refresh-dev-secret";
}

function getAccessExpiry(): string {
  return process.env.JWT_ACCESS_EXPIRES_IN || "15m";
}

function getRefreshExpiry(): string {
  return process.env.JWT_REFRESH_EXPIRES_IN || "30d";
}

/**
 * 解析过期时间为秒数
 */
function parseExpiryToSeconds(expiry: string): number {
  const match = expiry.match(/^(\d+)([smhd])$/);
  if (!match) return 900; // 默认 15 分钟

  const value = parseInt(match[1], 10);
  const unit = match[2];

  switch (unit) {
    case "s":
      return value;
    case "m":
      return value * 60;
    case "h":
      return value * 3600;
    case "d":
      return value * 86400;
    default:
      return 900;
  }
}

/**
 * 签发 Token 对
 */
export function generateTokenPair(payload: TokenPayload): TokenPair {
  const accessExpiryStr = getAccessExpiry();
  const refreshExpiryStr = getRefreshExpiry();
  const accessExpirySec = parseExpiryToSeconds(accessExpiryStr);
  const refreshExpirySec = parseExpiryToSeconds(refreshExpiryStr);

  const accessToken = jwt.sign(
    { ...payload, type: "access" },
    getAccessSecret(),
    { expiresIn: accessExpirySec },
  );

  const refreshToken = jwt.sign(
    { ...payload, type: "refresh" },
    getRefreshSecret(),
    { expiresIn: refreshExpirySec },
  );

  return {
    access_token: accessToken,
    refresh_token: refreshToken,
    expires_in: accessExpirySec,
  };
}

/**
 * 验证 Refresh Token
 */
export function verifyRefreshToken(token: string): TokenPayload & { type: string } {
  return jwt.verify(token, getRefreshSecret()) as TokenPayload & { type: string };
}

/**
 * 创建唯一的 JTI (JWT ID)
 */
export function createJti(): string {
  return uuidv4();
}

/**
 * 获取 Token 过期时间戳
 */
export function getTokenExpiry(token: string): Date {
  const decoded = jwt.decode(token) as { exp: number } | null;
  if (!decoded || !decoded.exp) {
    return new Date(Date.now() + 30 * 24 * 3600 * 1000); // 默认 30 天
  }
  return new Date(decoded.exp * 1000);
}
