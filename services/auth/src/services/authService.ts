// ============================================================
// 认证服务 — 核心业务逻辑: 注册、登录、Token 刷新、退出
// ============================================================

import bcrypt from "bcrypt";
import { PrismaClient } from "@prisma/client";
import type { RegisterInput, LoginInput } from "../models/schemas.js";
import type { AuthResponse, PublicUser, DeviceInfo, TokenPair } from "../../../../shared/types/index.js";
import { AppError } from "../utils/AppError.js";
import {
  generateTokenPair,
  verifyRefreshToken,
  createJti,
  getTokenExpiry,
} from "../utils/jwt.js";

const prisma = new PrismaClient();
const BCRYPT_COST = 12;

export class AuthService {
  /**
   * 用户注册
   * 1. 校验邮箱唯一性
   * 2. bcrypt 加密密码
   * 3. 创建用户记录
   * 4. 创建设备记录
   * 5. 签发 JWT Token 对
   * 6. 保存 Refresh Token
   */
  async register(input: RegisterInput): Promise<AuthResponse> {
    // 邮箱唯一性校验
    const existing = await prisma.user.findUnique({ where: { email: input.email } });
    if (existing) {
      throw new AppError(409, "该邮箱已被注册");
    }

    // 加密密码
    const passwordHash = await bcrypt.hash(input.password, BCRYPT_COST);

    // 创建用户
    const user = await prisma.user.create({
      data: {
        email: input.email,
        passwordHash,
      },
    });

    // 创建设备
    const device = await prisma.device.create({
      data: {
        userId: user.id,
        deviceName: input.device_name,
        deviceType: input.device_type,
        os: input.os,
        isOnline: true,
      },
    });

    // 签发 Token
    const jti = createJti();
    const tokens = generateTokenPair({
      sub: user.id,
      device_id: device.id,
      jti,
    });

    // 保存 Refresh Token
    await prisma.refreshToken.create({
      data: {
        userId: user.id,
        deviceId: device.id,
        tokenHash: await bcrypt.hash(tokens.refresh_token, 6),
        expiresAt: getTokenExpiry(tokens.refresh_token),
      },
    });

    return this.buildAuthResponse(user, device, tokens);
  }

  /**
   * 用户登录
   * 1. 查找用户
   * 2. 校验锁定状态
   * 3. 验证密码
   * 4. 记录/重置失败次数
   * 5. 创建或更新设备记录
   * 6. 签发 Token
   */
  async login(input: LoginInput): Promise<AuthResponse> {
    const user = await prisma.user.findUnique({ where: { email: input.email } });
    if (!user) {
      throw new AppError(401, "邮箱或密码错误");
    }

    // 校验锁定状态
    if (user.isLocked) {
      if (user.lockedUntil && new Date() < user.lockedUntil) {
        const remaining = Math.ceil(
          (user.lockedUntil.getTime() - Date.now()) / 60000,
        );
        throw new AppError(423, `账户已锁定，请在 ${remaining} 分钟后重试`);
      }
      // 锁定已过期，重置
      await prisma.user.update({
        where: { id: user.id },
        data: { isLocked: false, failedLoginAttempts: 0, lockedUntil: null },
      });
    }

    // 验证密码
    const valid = await bcrypt.compare(input.password, user.passwordHash);
    if (!valid) {
      const attempts = user.failedLoginAttempts + 1;
      const isLocked = attempts >= 5;

      await prisma.user.update({
        where: { id: user.id },
        data: {
          failedLoginAttempts: attempts,
          isLocked,
          lockedUntil: isLocked ? new Date(Date.now() + 15 * 60 * 1000) : null,
        },
      });

      throw new AppError(401, `邮箱或密码错误。剩余尝试次数: ${Math.max(0, 5 - attempts)}`);
    }

    // 密码正确，重置失败计数
    await prisma.user.update({
      where: { id: user.id },
      data: { failedLoginAttempts: 0, isLocked: false, lockedUntil: null },
    });

    // 查找或创建设备
    let device = await prisma.device.findFirst({
      where: {
        userId: user.id,
        deviceName: input.device_name,
      },
    });

    if (device) {
      device = await prisma.device.update({
        where: { id: device.id },
        data: { isOnline: true, lastSeen: new Date() },
      });
    } else {
      device = await prisma.device.create({
        data: {
          userId: user.id,
          deviceName: input.device_name,
          deviceType: input.device_type,
          os: input.os,
          isOnline: true,
        },
      });
    }

    // 签发 Token
    const jti = createJti();
    const tokens = generateTokenPair({
      sub: user.id,
      device_id: device.id,
      jti,
    });

    // 保存 Refresh Token
    await prisma.refreshToken.create({
      data: {
        userId: user.id,
        deviceId: device.id,
        tokenHash: await bcrypt.hash(tokens.refresh_token, 6),
        expiresAt: getTokenExpiry(tokens.refresh_token),
      },
    });

    return this.buildAuthResponse(user, device, tokens);
  }

  /**
   * Token 刷新（轮换）
   * 1. 验证 Refresh Token
   * 2. 查找数据库中的 Token 记录
   * 3. 撤销旧 Token
   * 4. 签发新 Token 对
   */
  async refreshToken(token: string): Promise<{ tokens: TokenPair; user: PublicUser }> {
    let payload;
    try {
      payload = verifyRefreshToken(token);
    } catch {
      throw new AppError(401, "无效或已过期的 Refresh Token");
    }

    if (payload.type !== "refresh") {
      throw new AppError(401, "请使用 Refresh Token 刷新");
    }

    // 查找数据库中的 Token 记录
    const tokenHash = await bcrypt.hash(token, 6);
    const storedToken = await prisma.refreshToken.findFirst({
      where: {
        userId: payload.sub,
        deviceId: payload.device_id,
        revoked: false,
      },
      include: { user: true },
    });

    if (!storedToken) {
      throw new AppError(401, "Token 已被撤销，请重新登录");
    }

    // 撤销旧 Token
    await prisma.refreshToken.update({
      where: { id: storedToken.id },
      data: { revoked: true },
    });

    // 签发新 Token 对
    const newJti = createJti();
    const tokens = generateTokenPair({
      sub: payload.sub,
      device_id: payload.device_id,
      jti: newJti,
    });

    // 保存新 Refresh Token
    await prisma.refreshToken.create({
      data: {
        userId: payload.sub,
        deviceId: payload.device_id,
        tokenHash: await bcrypt.hash(tokens.refresh_token, 6),
        expiresAt: getTokenExpiry(tokens.refresh_token),
      },
    });

    return {
      tokens,
      user: {
        id: storedToken.user.id,
        email: storedToken.user.email,
        created_at: storedToken.user.createdAt.toISOString(),
      },
    };
  }

  /**
   * 退出登录
   * @param allDevices 是否退出所有设备
   */
  async logout(userId: string, deviceId: string, allDevices: boolean): Promise<void> {
    if (allDevices) {
      // 撤销该用户所有未撤销的 Refresh Token
      await prisma.refreshToken.updateMany({
        where: { userId, revoked: false },
        data: { revoked: true },
      });

      // 标记所有设备离线
      await prisma.device.updateMany({
        where: { userId },
        data: { isOnline: false },
      });
    } else {
      // 撤销当前设备的 Refresh Token
      await prisma.refreshToken.updateMany({
        where: { deviceId, revoked: false },
        data: { revoked: true },
      });

      // 标记设备离线
      await prisma.device.update({
        where: { id: deviceId },
        data: { isOnline: false },
      });
    }
  }

  /**
   * 获取用户信息
   */
  async getUserById(userId: string): Promise<PublicUser> {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new AppError(404, "用户不存在");
    return {
      id: user.id,
      email: user.email,
      created_at: user.createdAt.toISOString(),
    };
  }

  /**
   * 构建标准认证响应
   */
  private buildAuthResponse(
    user: { id: string; email: string; createdAt: Date },
    device: { id: string; deviceName: string; deviceType: string; os: string; isOnline: boolean; firstSeen: Date; lastSeen: Date },
    tokens: TokenPair,
  ): AuthResponse {
    return {
      user: {
        id: user.id,
        email: user.email,
        created_at: user.createdAt.toISOString(),
      },
      tokens,
      device: {
        id: device.id,
        device_name: device.deviceName,
        device_type: device.deviceType as "desktop" | "phone" | "tablet",
        os: device.os as "windows" | "macos" | "android" | "ios",
        is_online: device.isOnline,
        first_seen: device.firstSeen.toISOString(),
        last_seen: device.lastSeen.toISOString(),
        is_current: true,
      },
    };
  }
}
