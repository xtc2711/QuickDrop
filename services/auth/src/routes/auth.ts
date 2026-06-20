// ============================================================
// 认证服务 — 路由: /api/v1/auth
// ============================================================

import { Router } from "express";
import type { Request, Response, NextFunction } from "express";
import { registerSchema, loginSchema, refreshSchema, logoutSchema, changePasswordSchema, forgotPasswordSchema, resetPasswordSchema } from "../models/schemas.js";
import { AuthService } from "../services/authService.js";
import { rateLimitMiddleware } from "../middleware/rateLimiter.js";
import { authenticateToken } from "../middleware/authMiddleware.js";
import { getRateLimit } from "../config/rateLimit.js";
import { AppError } from "../utils/AppError.js";

export const authRouter = Router();

const authService = new AuthService();

/**
 * POST /api/v1/auth/register
 * 注册新用户并自动登录当前设备
 */
authRouter.post(
  "/register",
  rateLimitMiddleware(getRateLimit("REGISTER")),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = registerSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new AppError(400, "请求参数校验失败", parsed.error.flatten());
      }

      const result = await authService.register(parsed.data);
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  },
);

/**
 * POST /api/v1/auth/login
 * 用户登录，签发 Token，记录设备会话
 */
authRouter.post(
  "/login",
  rateLimitMiddleware(getRateLimit("LOGIN")),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = loginSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new AppError(400, "请求参数校验失败", parsed.error.flatten());
      }

      const result = await authService.login(parsed.data);
      res.json(result);
    } catch (err) {
      next(err);
    }
  },
);

/**
 * POST /api/v1/auth/refresh
 * 使用 Refresh Token 换取新的 Token 对
 */
authRouter.post(
  "/refresh",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = refreshSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new AppError(400, "请求参数校验失败", parsed.error.flatten());
      }

      const result = await authService.refreshToken(parsed.data.refresh_token);
      res.json(result);
    } catch (err) {
      next(err);
    }
  },
);

/**
 * POST /api/v1/auth/logout
 * 退出登录，撤销 Token
 */
authRouter.post(
  "/logout",
  authenticateToken,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = logoutSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new AppError(400, "请求参数校验失败", parsed.error.flatten());
      }

      const userId = req.user!.sub;
      const deviceId = req.user!.device_id;
      const jti = req.user!.jti;
      const exp = req.user!.exp;
      await authService.logout(userId, deviceId, parsed.data.all_devices, jti, exp);
      res.json({ message: "已退出登录" });
    } catch (err) {
      next(err);
    }
  },
);

/**
 * POST /api/v1/auth/change-password
 * 修改密码（需要登录）
 * 默认撤销其他设备登录，强制重新认证
 */
authRouter.post(
  "/change-password",
  authenticateToken,
  rateLimitMiddleware(getRateLimit("CHANGE_PASSWORD")),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = changePasswordSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new AppError(400, "请求参数校验失败", parsed.error.flatten());
      }

      const userId = req.user!.sub;
      const deviceId = req.user!.device_id;
      const jti = req.user!.jti;
      const exp = req.user!.exp;
      const result = await authService.changePassword(
        userId,
        deviceId,
        parsed.data,
        jti,
        exp,
      );
      res.json(result);
    } catch (err) {
      next(err);
    }
  },
);

/**
 * POST /api/v1/auth/forgot-password
 * 请求密码重置（无需登录）
 * 即使用户不存在也返回相同消息，防止邮箱枚举攻击
 */
authRouter.post(
  "/forgot-password",
  rateLimitMiddleware(getRateLimit("FORGOT_PASSWORD")),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = forgotPasswordSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new AppError(400, "请求参数校验失败", parsed.error.flatten());
      }

      const result = await authService.requestPasswordReset(parsed.data.email);
      res.json(result);
    } catch (err) {
      next(err);
    }
  },
);

/**
 * POST /api/v1/auth/reset-password
 * 使用重置令牌重置密码（无需登录）
 */
authRouter.post(
  "/reset-password",
  rateLimitMiddleware(getRateLimit("RESET_PASSWORD")),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = resetPasswordSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new AppError(400, "请求参数校验失败", parsed.error.flatten());
      }

      const result = await authService.resetPassword(
        parsed.data.token,
        parsed.data.new_password,
      );
      res.json(result);
    } catch (err) {
      next(err);
    }
  },
);

/**
 * GET /api/v1/auth/me
 * 获取当前用户信息
 */
authRouter.get(
  "/me",
  authenticateToken,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = await authService.getUserById(req.user!.sub);
      res.json(user);
    } catch (err) {
      next(err);
    }
  },
);
