// ============================================================
// 认证服务 — 核心业务逻辑测试
// 覆盖：注册、登录、Token 刷新、退出登录
// ============================================================

import { describe, it, expect, vi, beforeEach } from "vitest";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { AuthService } from "../src/services/authService.js";
import { AppError } from "../src/utils/AppError.js";
import { mockPrisma } from "./setup.js";
import type { RegisterInput, LoginInput } from "../src/models/schemas.js";

// 设置 jwt 签名所需的环境变量
process.env.JWT_ACCESS_SECRET = "test-access-secret";
process.env.JWT_REFRESH_SECRET = "test-refresh-secret";
process.env.JWT_ACCESS_EXPIRES_IN = "15m";
process.env.JWT_REFRESH_EXPIRES_IN = "30d";

const authService = new AuthService();

// 测试数据工厂函数
function validRegisterInput(overrides = {}): RegisterInput {
  return {
    email: "test@example.com",
    password: "StrongPass1",
    device_name: "MacBook Pro",
    device_type: "desktop",
    os: "macos",
    ...overrides,
  };
}

function validLoginInput(overrides = {}): LoginInput {
  return {
    email: "test@example.com",
    password: "StrongPass1",
    device_name: "MacBook Pro",
    device_type: "desktop",
    os: "macos",
    ...overrides,
  };
}

// 模拟数据库记录
function mockUser(overrides = {}) {
  return {
    id: "user-001",
    email: "test@example.com",
    passwordHash: "$2b$12$hashedpassword...",
    createdAt: new Date("2025-01-01"),
    updatedAt: new Date("2025-01-01"),
    isLocked: false,
    lockedUntil: null,
    failedLoginAttempts: 0,
    ...overrides,
  };
}

function mockDevice(overrides = {}) {
  return {
    id: "device-001",
    userId: "user-001",
    deviceName: "MacBook Pro",
    deviceType: "desktop",
    os: "macos",
    firstSeen: new Date("2025-01-01"),
    lastSeen: new Date("2025-01-01"),
    isOnline: true,
    isActive: true,
    ...overrides,
  };
}

// ============================================================
// 注册测试
// ============================================================
describe("AuthService.register()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("成功注册新用户：创建用户、设备、签发 Token", async () => {
    // arrange
    mockPrisma.user.findUnique.mockResolvedValue(null); // 邮箱未被注册
    mockPrisma.user.create.mockResolvedValue(mockUser());
    mockPrisma.device.create.mockResolvedValue(mockDevice());
    mockPrisma.refreshToken.create.mockResolvedValue({});
    vi.mocked(bcrypt.hash).mockResolvedValue("$2b$12$hashedpassword..." as never);

    // act
    const result = await authService.register(validRegisterInput());

    // assert
    expect(result.user.email).toBe("test@example.com");
    expect(result.tokens.access_token).toBeTruthy();
    expect(result.tokens.refresh_token).toBeTruthy();
    expect(result.tokens.expires_in).toBe(900); // 15 minutes
    expect(result.device.device_name).toBe("MacBook Pro");
    expect(result.device.is_current).toBe(true);

    // 验证 bcrypt 以 cost=12 加密
    expect(bcrypt.hash).toHaveBeenCalledWith("StrongPass1", 12);
    // 验证用户创建
    expect(mockPrisma.user.create).toHaveBeenCalledTimes(1);
  });

  it("重复邮箱注册应返回 409", async () => {
    // arrange
    mockPrisma.user.findUnique.mockResolvedValue(mockUser());

    // act & assert
    await expect(
      authService.register(validRegisterInput()),
    ).rejects.toThrow(AppError);

    try {
      await authService.register(validRegisterInput());
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).statusCode).toBe(409);
      expect((err as AppError).message).toContain("已被注册");
    }
  });

  it("应使用 bcrypt cost=12 加密密码", async () => {
    // arrange
    mockPrisma.user.findUnique.mockResolvedValue(null);
    mockPrisma.user.create.mockResolvedValue(mockUser());
    mockPrisma.device.create.mockResolvedValue(mockDevice());
    mockPrisma.refreshToken.create.mockResolvedValue({});
    vi.mocked(bcrypt.hash).mockResolvedValue("$2b$12$hashedpassword..." as never);

    // act
    await authService.register(validRegisterInput());

    // assert
    expect(bcrypt.hash).toHaveBeenCalledWith(expect.any(String), 12);
  });
});

// ============================================================
// 登录测试
// ============================================================
describe("AuthService.login()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("正确凭证登录成功，返回 Token 和设备信息", async () => {
    // arrange
    const user = mockUser();
    mockPrisma.user.findUnique.mockResolvedValue(user);
    vi.mocked(bcrypt.compare).mockResolvedValue(true as never);
    mockPrisma.user.update.mockResolvedValue(user);
    mockPrisma.device.findFirst.mockResolvedValue(null); // 新设备
    mockPrisma.device.create.mockResolvedValue(mockDevice());
    mockPrisma.refreshToken.create.mockResolvedValue({});

    // act
    const result = await authService.login(validLoginInput());

    // assert
    expect(result.user.email).toBe("test@example.com");
    expect(result.tokens.access_token).toBeTruthy();
    expect(result.tokens.refresh_token).toBeTruthy();
    // 密码正确后重置失败计数
    expect(mockPrisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          failedLoginAttempts: 0,
          isLocked: false,
        }),
      }),
    );
  });

  it("错误密码提示明确，记录失败次数", async () => {
    // arrange
    const user = mockUser();
    mockPrisma.user.findUnique.mockResolvedValue(user);
    vi.mocked(bcrypt.compare).mockResolvedValue(false as never);
    mockPrisma.user.update.mockResolvedValue(user);

    // act & assert
    try {
      await authService.login(validLoginInput({ password: "WrongPass1" }));
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).statusCode).toBe(401);
      expect((err as AppError).message).toContain("邮箱或密码错误");
    }

    // 验证失败次数递增
    expect(mockPrisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          failedLoginAttempts: 1,
        }),
      }),
    );
  });

  it("连续 5 次失败后锁定 15 分钟", async () => {
    // arrange
    const user = mockUser({ failedLoginAttempts: 4 }); // 第 4 次失败后
    // 第 5 次登录（即第 5 次失败）
    mockPrisma.user.findUnique.mockResolvedValue(user);
    vi.mocked(bcrypt.compare).mockResolvedValue(false as never);

    // act & assert
    try {
      await authService.login(validLoginInput({ password: "WrongPass1" }));
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
    }

    // 验证锁定状态
    const updateCall = vi.mocked(mockPrisma.user.update).mock.calls[0];
    const updateData = (updateCall?.[0] as { data: Record<string, unknown> })?.data;
    expect(updateData?.isLocked).toBe(true);
    expect(updateData?.lockedUntil).toBeTruthy();
  });

  it("未知邮箱返回通用错误（防止用户枚举）", async () => {
    // arrange
    mockPrisma.user.findUnique.mockResolvedValue(null);

    // act & assert
    try {
      await authService.login(validLoginInput({ email: "unknown@test.com" }));
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).statusCode).toBe(401);
      expect((err as AppError).message).toContain("邮箱或密码错误");
    }
  });

  it("锁定期间拒绝登录", async () => {
    // arrange
    const futureLock = new Date(Date.now() + 10 * 60 * 1000); // 10 分钟后解锁
    const user = mockUser({
      isLocked: true,
      lockedUntil: futureLock,
    });
    mockPrisma.user.findUnique.mockResolvedValue(user);

    // act & assert
    try {
      await authService.login(validLoginInput());
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).statusCode).toBe(423);
      expect((err as AppError).message).toContain("账户已锁定");
    }
  });

  it("锁定过期后自动解锁并允许登录", async () => {
    // arrange
    const pastLock = new Date(Date.now() - 10 * 60 * 1000); // 10 分钟前已过期
    const user = mockUser({
      isLocked: true,
      lockedUntil: pastLock,
    });
    mockPrisma.user.findUnique.mockResolvedValue(user);
    vi.mocked(bcrypt.compare).mockResolvedValue(true as never);
    mockPrisma.user.update.mockResolvedValue(user);
    mockPrisma.device.findFirst.mockResolvedValue(mockDevice());
    mockPrisma.device.update.mockResolvedValue(mockDevice());
    mockPrisma.refreshToken.create.mockResolvedValue({});

    // act
    const result = await authService.login(validLoginInput());

    // assert
    expect(result.user.email).toBe("test@example.com");
    // 验证锁被重置
    expect(mockPrisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          isLocked: false,
          failedLoginAttempts: 0,
          lockedUntil: null,
        }),
      }),
    );
  });
});

// ============================================================
// Token 刷新测试
// ============================================================
describe("AuthService.refreshToken()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("有效 Refresh Token 应返回新 Token 对（轮换）", async () => {
    // arrange
    const oldToken = jwt.sign(
      {
        sub: "user-001",
        device_id: "device-001",
        jti: "old-jti-001",
        type: "refresh",
      },
      process.env.JWT_REFRESH_SECRET!,
      { expiresIn: "30d" },
    );

    const storedToken = {
      id: "rt-001",
      userId: "user-001",
      deviceId: "device-001",
      tokenHash: expect.any(String),
      revoked: false,
      user: { id: "user-001", email: "test@example.com", createdAt: new Date() },
    };

    mockPrisma.refreshToken.findFirst.mockResolvedValue(storedToken);
    mockPrisma.refreshToken.update.mockResolvedValue({});
    mockPrisma.refreshToken.create.mockResolvedValue({});

    // act
    const result = await authService.refreshToken(oldToken);

    // assert
    expect(result.tokens.access_token).toBeTruthy();
    expect(result.tokens.refresh_token).toBeTruthy();
    expect(result.user.email).toBe("test@example.com");
    // 旧 Token 被撤销
    expect(mockPrisma.refreshToken.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { revoked: true },
      }),
    );
  });

  it("无效 Token 应返回 401", async () => {
    // act & assert
    await expect(
      authService.refreshToken("invalid-token"),
    ).rejects.toThrow(AppError);

    try {
      await authService.refreshToken("invalid-token");
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).statusCode).toBe(401);
    }
  });

  it("已撤销的 Token 应返回 401", async () => {
    // arrange
    const token = jwt.sign(
      {
        sub: "user-001",
        device_id: "device-001",
        jti: "revoked-jti",
        type: "refresh",
      },
      process.env.JWT_REFRESH_SECRET!,
      { expiresIn: "30d" },
    );

    mockPrisma.refreshToken.findFirst.mockResolvedValue(null); // Token 已撤销或不存在

    // act & assert
    try {
      await authService.refreshToken(token);
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).statusCode).toBe(401);
      expect((err as AppError).message).toContain("已被撤销");
    }
  });
});

// ============================================================
// 退出登录测试
// ============================================================
describe("AuthService.logout()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("单设备退出：撤销该设备 Token，标记设备离线", async () => {
    // arrange
    mockPrisma.refreshToken.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.device.update.mockResolvedValue(mockDevice({ isOnline: false }));

    // act
    await authService.logout("user-001", "device-001", false, "jti-001", 9999999999);

    // assert
    expect(mockPrisma.refreshToken.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { deviceId: "device-001", revoked: false },
        data: { revoked: true },
      }),
    );
    expect(mockPrisma.device.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "device-001" },
        data: { isOnline: false },
      }),
    );
  });

  it("全设备退出：撤销所有 Token，所有设备下线", async () => {
    // arrange
    mockPrisma.refreshToken.updateMany.mockResolvedValue({ count: 3 });
    mockPrisma.device.updateMany.mockResolvedValue({ count: 3 });

    // act
    await authService.logout("user-001", "device-001", true, "jti-001", 9999999999);

    // assert
    expect(mockPrisma.refreshToken.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: "user-001", revoked: false },
      }),
    );
    expect(mockPrisma.device.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: "user-001" },
      }),
    );
  });
});
