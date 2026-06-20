// ============================================================
// QuickDrop — 端到端集成测试
// 覆盖完整用户流程：
//   注册 → 登录 → Token 刷新 → 自动配对 →
//   文件传输（编码/CRC32/解码/SHA256校验）→ 退出登录
//
// 使用 Mock 层模拟 Prisma / bcrypt / WebSocket，
// 验证所有模块正确协作完成业务流程。
// ============================================================

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";

// ---------- 认证服务 ----------
import { AuthService } from "../src/services/authService.js";
import { AppError } from "../src/utils/AppError.js";
import { mockPrisma } from "./setup.js";

// ---------- 信令服务 ----------
import { DeviceManager } from "../../signal/src/services/deviceManager.js";
import { PairingService } from "../../signal/src/services/pairingService.js";

// ---------- 文件传输 ----------
import {
  encodeChunk,
  decodeChunk,
} from "../../../desktop/src/services/fileTransfer.js";
import { crc32, CHUNK_SIZE, MAX_RETRY_COUNT, MAX_PARALLEL_TRANSFERS } from "../../../shared/utils/index.js";

// ---------- JWT 环境变量 ----------
process.env.JWT_ACCESS_SECRET = "e2e-access-secret";
process.env.JWT_REFRESH_SECRET = "e2e-refresh-secret";
process.env.JWT_ACCESS_EXPIRES_IN = "15m";
process.env.JWT_REFRESH_EXPIRES_IN = "30d";

// ============================================================
// 测试数据工厂
// ============================================================

function mockUserRecord(overrides = {}) {
  return {
    id: "e2e-user-001",
    email: "e2e_test@quickdrop.dev",
    passwordHash: "$2b$12$e2ehashedpassword...",
    createdAt: new Date("2025-06-01"),
    updatedAt: new Date("2025-06-01"),
    isLocked: false,
    lockedUntil: null,
    failedLoginAttempts: 0,
    ...overrides,
  };
}

function mockDeviceRecord(overrides = {}) {
  return {
    id: "e2e-device-mac",
    userId: "e2e-user-001",
    deviceName: "MacBook Pro",
    deviceType: "desktop",
    os: "macos",
    firstSeen: new Date("2025-06-01"),
    lastSeen: new Date("2025-06-01"),
    isOnline: true,
    isActive: true,
    ...overrides,
  };
}

function mockRefreshTokenRecord() {
  return {
    id: "e2e-rt-001",
    userId: "e2e-user-001",
    deviceId: "e2e-device-mac",
    tokenHash: expect.any(String),
    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    revoked: false,
    user: {
      id: "e2e-user-001",
      email: "e2e_test@quickdrop.dev",
      createdAt: new Date("2025-06-01"),
    },
  };
}

// ============================================================
// Mock WebSocket（模拟信令服务中的设备连接）
// ============================================================

function createSignalMockWs() {
  const listeners: Record<string, Array<(...args: unknown[]) => void>> = {};
  return {
    send: vi.fn(),
    close: vi.fn(),
    terminate: vi.fn(),
    OPEN: 1,
    readyState: 1,
    on: vi.fn((event: string, fn: (...args: unknown[]) => void) => {
      if (!listeners[event]) listeners[event] = [];
      listeners[event].push(fn);
    }),
    once: vi.fn(),
    removeListener: vi.fn(),
    // 内部：触发事件
    _trigger(event: string, data: unknown) {
      for (const fn of listeners[event] || []) fn(data);
    },
    _listeners: listeners,
  };
}

// ============================================================
// 1. 认证流程 E2E 测试
// ============================================================

describe("🔐 E2E — 认证流程：注册 → 登录 → Token 刷新 → 退出", () => {
  const authService = new AuthService();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("场景 1: 新用户注册并自动登录", () => {
    it("完整注册流程：创建用户 → 设备 → 签发 Token", async () => {
      // arrange: 邮箱未被占用
      mockPrisma.user.findUnique.mockResolvedValue(null);
      mockPrisma.user.create.mockResolvedValue(mockUserRecord());
      mockPrisma.device.create.mockResolvedValue(mockDeviceRecord());
      mockPrisma.refreshToken.create.mockResolvedValue({});
      vi.mocked(bcrypt.hash).mockResolvedValue("$2b$12$e2ehashedpassword..." as never);

      // act: 注册
      const result = await authService.register({
        email: "e2e_test@quickdrop.dev",
        password: "StrongPass1",
        device_name: "MacBook Pro",
        device_type: "desktop",
        os: "macos",
      });

      // assert: 完整响应结构
      expect(result.user.email).toBe("e2e_test@quickdrop.dev");
      expect(result.user.id).toBe("e2e-user-001");
      expect(result.tokens.access_token).toBeTruthy();
      expect(result.tokens.refresh_token).toBeTruthy();
      expect(result.tokens.expires_in).toBe(900);
      expect(result.device.device_name).toBe("MacBook Pro");
      expect(result.device.device_type).toBe("desktop");
      expect(result.device.os).toBe("macos");
      expect(result.device.is_online).toBe(true);
      expect(result.device.is_current).toBe(true);

      // 验证 bcrypt 使用 cost=12
      expect(bcrypt.hash).toHaveBeenCalledWith("StrongPass1", 12);

      // 验证用户创建
      expect(mockPrisma.user.create).toHaveBeenCalledWith({
        data: {
          email: "e2e_test@quickdrop.dev",
          passwordHash: "$2b$12$e2ehashedpassword...",
        },
      });

      // 验证设备创建
      expect(mockPrisma.device.create).toHaveBeenCalledWith({
        data: {
          userId: "e2e-user-001",
          deviceName: "MacBook Pro",
          deviceType: "desktop",
          os: "macos",
          isOnline: true,
        },
      });
    });

    it("重复邮箱注册应拒绝", async () => {
      mockPrisma.user.findUnique.mockResolvedValue(mockUserRecord());

      await expect(
        authService.register({
          email: "e2e_test@quickdrop.dev",
          password: "StrongPass1",
          device_name: "iPhone 16",
          device_type: "phone",
          os: "ios",
        }),
      ).rejects.toThrow(AppError);

      try {
        await authService.register({
          email: "e2e_test@quickdrop.dev",
          password: "StrongPass1",
          device_name: "iPhone 16",
          device_type: "phone",
          os: "ios",
        });
      } catch (err) {
        expect(err).toBeInstanceOf(AppError);
        expect((err as AppError).statusCode).toBe(409);
        expect((err as AppError).message).toContain("已被注册");
      }
    });
  });

  describe("场景 2: 已有用户登录", () => {
    it("正确凭证登录 → 更新设备在线状态 → 签发 Token", async () => {
      // arrange: 已有用户
      const user = mockUserRecord();
      mockPrisma.user.findUnique.mockResolvedValue(user);
      vi.mocked(bcrypt.compare).mockResolvedValue(true as never);
      mockPrisma.user.update.mockResolvedValue(user);

      // 设备不存在（新设备登录）
      mockPrisma.device.findFirst.mockResolvedValue(null);
      mockPrisma.device.create.mockResolvedValue(
        mockDeviceRecord({ id: "e2e-device-iphone", deviceName: "iPhone 16", deviceType: "phone", os: "ios" }),
      );
      mockPrisma.refreshToken.create.mockResolvedValue({});

      // act: 登录
      const result = await authService.login({
        email: "e2e_test@quickdrop.dev",
        password: "StrongPass1",
        device_name: "iPhone 16",
        device_type: "phone",
        os: "ios",
      });

      // assert
      expect(result.user.email).toBe("e2e_test@quickdrop.dev");
      expect(result.tokens.access_token).toBeTruthy();
      expect(result.device.device_name).toBe("iPhone 16");
      expect(result.device.device_type).toBe("phone");
      expect(result.device.os).toBe("ios");
    });

    it("已有设备再次登录 → 复用设备记录并更新在线状态", async () => {
      const user = mockUserRecord();
      mockPrisma.user.findUnique.mockResolvedValue(user);
      vi.mocked(bcrypt.compare).mockResolvedValue(true as never);
      mockPrisma.user.update.mockResolvedValue(user);

      // 设备已存在
      const existingDevice = mockDeviceRecord();
      mockPrisma.device.findFirst.mockResolvedValue(existingDevice);
      mockPrisma.device.update.mockResolvedValue({
        ...existingDevice,
        lastSeen: new Date(),
      });
      mockPrisma.refreshToken.create.mockResolvedValue({});

      const result = await authService.login({
        email: "e2e_test@quickdrop.dev",
        password: "StrongPass1",
        device_name: "MacBook Pro",
        device_type: "desktop",
        os: "macos",
      });

      // 设备记录被更新而非新建
      expect(mockPrisma.device.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ isOnline: true }),
        }),
      );
      expect(mockPrisma.device.create).not.toHaveBeenCalled();
      expect(result.device.device_name).toBe("MacBook Pro");
    });

    it("连续 5 次错误密码 → 账户锁定", async () => {
      const user = mockUserRecord({ failedLoginAttempts: 4 });
      mockPrisma.user.findUnique.mockResolvedValue(user);
      vi.mocked(bcrypt.compare).mockResolvedValue(false as never);

      try {
        await authService.login({
          email: "e2e_test@quickdrop.dev",
          password: "WrongPass1",
          device_name: "MacBook Pro",
          device_type: "desktop",
          os: "macos",
        });
      } catch (err) {
        expect(err).toBeInstanceOf(AppError);
        expect((err as AppError).statusCode).toBe(401);
      }

      // 验证锁定
      const updateCall = vi.mocked(mockPrisma.user.update).mock.calls[0];
      const updateData = (updateCall?.[0] as { data: Record<string, unknown> })?.data;
      expect(updateData?.isLocked).toBe(true);
      expect(updateData?.lockedUntil).toBeTruthy();
      expect(updateData?.failedLoginAttempts).toBe(5);
    });
  });

  describe("场景 3: Token 刷新", () => {
    it("有效 Refresh Token → 轮换新 Token 对", async () => {
      // 用真实 JWT 签发一个 Refresh Token
      const oldToken = jwt.sign(
        { sub: "e2e-user-001", device_id: "e2e-device-mac", jti: "old-jti", type: "refresh" },
        process.env.JWT_REFRESH_SECRET!,
        { expiresIn: "30d" },
      );

      const storedToken = mockRefreshTokenRecord();
      mockPrisma.refreshToken.findFirst.mockResolvedValue(storedToken);
      mockPrisma.refreshToken.update.mockResolvedValue({});
      mockPrisma.refreshToken.create.mockResolvedValue({});

      const result = await authService.refreshToken(oldToken);

      // 新 Token 签发
      expect(result.tokens.access_token).toBeTruthy();
      expect(result.tokens.refresh_token).toBeTruthy();
      expect(result.user.email).toBe("e2e_test@quickdrop.dev");

      // 旧 Token 被撤销（轮换）
      expect(mockPrisma.refreshToken.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { revoked: true } }),
      );

      // 新 Token 已保存
      expect(mockPrisma.refreshToken.create).toHaveBeenCalled();
    });

    it("已撤销的 Token → 拒绝刷新", async () => {
      const token = jwt.sign(
        { sub: "e2e-user-001", device_id: "e2e-device-mac", jti: "revoked-jti", type: "refresh" },
        process.env.JWT_REFRESH_SECRET!,
        { expiresIn: "30d" },
      );

      mockPrisma.refreshToken.findFirst.mockResolvedValue(null);

      await expect(authService.refreshToken(token)).rejects.toThrow(AppError);

      try {
        await authService.refreshToken(token);
      } catch (err) {
        expect(err).toBeInstanceOf(AppError);
        expect((err as AppError).statusCode).toBe(401);
      }
    });
  });

  describe("场景 4: 退出登录", () => {
    it("单设备退出 → 撤销该设备 Token → 标记离线", async () => {
      mockPrisma.refreshToken.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.device.update.mockResolvedValue(
        mockDeviceRecord({ isOnline: false }),
      );

      await authService.logout("e2e-user-001", "e2e-device-mac", false, "jti-001", 9999999999);

      // 仅撤销该设备的 Token
      expect(mockPrisma.refreshToken.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { deviceId: "e2e-device-mac", revoked: false },
        }),
      );

      // 仅标记该设备离线
      expect(mockPrisma.device.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "e2e-device-mac" },
          data: { isOnline: false },
        }),
      );
    });

    it("全设备退出 → 撤销所有 Token → 全部离线", async () => {
      mockPrisma.refreshToken.updateMany.mockResolvedValue({ count: 3 });
      mockPrisma.device.updateMany.mockResolvedValue({ count: 3 });

      await authService.logout("e2e-user-001", "e2e-device-mac", true, "jti-001", 9999999999);

      // 撤销所有设备的 Token
      expect(mockPrisma.refreshToken.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: "e2e-user-001", revoked: false },
        }),
      );

      // 所有设备下线
      expect(mockPrisma.device.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: "e2e-user-001" },
        }),
      );
    });
  });
});

// ============================================================
// 2. 设备自动配对 E2E 测试
// ============================================================

describe("📶 E2E — 自动配对流程：同账户设备发现", () => {
  let deviceManager: DeviceManager;

  beforeEach(() => {
    vi.clearAllMocks();
    // 新建实例以确保测试隔离
    deviceManager = new DeviceManager();
  });

  afterEach(() => {
    // 清理所有设备
    const deviceIds = Array.from(
      (deviceManager as unknown as { devices: Map<string, unknown> }).devices.keys?.() ?? [],
    );
    for (const id of deviceIds) {
      deviceManager.unregister(id);
    }
  });

  it("场景 5: 两个同账户设备上线 → 互相发现", () => {
    // 设备 A (MacBook) 上线
    const wsA = createSignalMockWs();
    deviceManager.register({
      ws: wsA as unknown as import("ws").WebSocket,
      userId: "e2e-user-001",
      deviceId: "e2e-device-mac",
      deviceName: "MacBook Pro",
      deviceType: "desktop",
      os: "macos",
      connectedAt: new Date(),
      lastHeartbeat: new Date(),
      isAlive: true,
    });

    // 设备 A 收到当前在线设备列表（此时应无其他设备）
    expect(wsA.send).toHaveBeenCalledTimes(1);
    const listMsgA = JSON.parse(vi.mocked(wsA.send).mock.calls[0]?.[0] as string);
    expect(listMsgA.type).toBe("device_list_update");
    expect(listMsgA.payload.online_devices).toHaveLength(0);

    // 设备 B (iPhone) 上线
    const wsB = createSignalMockWs();
    deviceManager.register({
      ws: wsB as unknown as import("ws").WebSocket,
      userId: "e2e-user-001",
      deviceId: "e2e-device-iphone",
      deviceName: "iPhone 16",
      deviceType: "phone",
      os: "ios",
      connectedAt: new Date(),
      lastHeartbeat: new Date(),
      isAlive: true,
    });

    // 设备 B 收到的设备列表应包含设备 A
    expect(wsB.send).toHaveBeenCalledTimes(1);
    const listMsgB = JSON.parse(vi.mocked(wsB.send).mock.calls[0]?.[0] as string);
    expect(listMsgB.type).toBe("device_list_update");
    expect(listMsgB.payload.online_devices).toHaveLength(1);
    expect(listMsgB.payload.online_devices[0].device_id).toBe("e2e-device-mac");
    expect(listMsgB.payload.online_devices[0].device_name).toBe("MacBook Pro");

    // 设备 A 应收到设备 B 的上线通知
    const notifCount = vi.mocked(wsA.send).mock.calls.length;
    expect(notifCount).toBe(2); // list_update + device_online notification
    const notifMsg = JSON.parse(vi.mocked(wsA.send).mock.calls[1]?.[0] as string);
    expect(notifMsg.type).toBe("device_online");
    expect(notifMsg.payload.device_id).toBe("e2e-device-iphone");
  });

  it("场景 6: 设备离线 → 通知其他同账户设备", () => {
    const wsA = createSignalMockWs();
    const wsB = createSignalMockWs();

    // 两台设备上线
    deviceManager.register({
      ws: wsA as unknown as import("ws").WebSocket,
      userId: "e2e-user-001",
      deviceId: "e2e-device-mac",
      deviceName: "MacBook Pro",
      deviceType: "desktop",
      os: "macos",
      connectedAt: new Date(),
      lastHeartbeat: new Date(),
      isAlive: true,
    });

    deviceManager.register({
      ws: wsB as unknown as import("ws").WebSocket,
      userId: "e2e-user-001",
      deviceId: "e2e-device-iphone",
      deviceName: "iPhone 16",
      deviceType: "phone",
      os: "ios",
      connectedAt: new Date(),
      lastHeartbeat: new Date(),
      isAlive: true,
    });

    // 重置 mock 计数
    vi.mocked(wsA.send).mockClear();
    vi.mocked(wsB.send).mockClear();

    // 设备 B 离线
    deviceManager.unregister("e2e-device-iphone");

    // 设备 A 收到 device_offline 通知
    expect(wsA.send).toHaveBeenCalledTimes(1);
    const offlineMsg = JSON.parse(vi.mocked(wsA.send).mock.calls[0]?.[0] as string);
    expect(offlineMsg.type).toBe("device_offline");
    expect(offlineMsg.payload.device_id).toBe("e2e-device-iphone");

    // 设备 B 不会收到自己的下线通知
    expect(wsB.send).not.toHaveBeenCalled();
  });

  it("场景 7: 心跳维持在线状态", () => {
    const ws = createSignalMockWs();
    deviceManager.register({
      ws: ws as unknown as import("ws").WebSocket,
      userId: "e2e-user-001",
      deviceId: "e2e-device-mac",
      deviceName: "MacBook Pro",
      deviceType: "desktop",
      os: "macos",
      connectedAt: new Date(),
      lastHeartbeat: new Date(Date.now() - 60_000), // 1 分钟前
      isAlive: true,
    });

    // 发送心跳
    deviceManager.heartbeat("e2e-device-mac");

    // 设备心跳应更新
    const device = deviceManager.get("e2e-device-mac");
    expect(device).toBeDefined();
    expect(device!.isAlive).toBe(true);
    // 心跳时间应接近现在
    expect(device!.lastHeartbeat.getTime()).toBeGreaterThan(Date.now() - 1000);
  });
});

// ============================================================
// 3. 文件传输 E2E 测试
// ============================================================

describe("📁 E2E — 文件传输：编码 → CRC32 → 解码 → SHA256", () => {
  describe("场景 8: 单个分块编解码往返", () => {
    it("编码 → 解码 往返：数据完整一致、CRC32 匹配", () => {
      // 准备测试数据（模拟一个 16KB 分块）
      const originalData = new Uint8Array(CHUNK_SIZE);
      for (let i = 0; i < CHUNK_SIZE; i++) {
        originalData[i] = (i * 7 + 13) % 256; // 确定性伪随机数据
      }

      // 计算 CRC32
      const originalCrc = crc32(originalData.buffer);

      // 编码分块
      const fileId = "e2e-file-001";
      const chunkIndex = 42;
      const encoded = encodeChunk(fileId, chunkIndex, originalCrc, originalData.buffer);

      // 验证编码后的总大小 = header + data
      // header: [fileIdLen:4][fileId:12][chunkIdx:4][crc32:4] = 24 bytes
      const expectedHeaderSize = 4 + fileId.length + 4 + 4;
      expect(encoded.byteLength).toBe(expectedHeaderSize + CHUNK_SIZE);

      // 解码分块
      const decoded = decodeChunk(encoded);
      expect(decoded).not.toBeNull();
      expect(decoded!.fileId).toBe(fileId);
      expect(decoded!.chunkIndex).toBe(chunkIndex);
      expect(decoded!.crc32).toBe(originalCrc);

      // 验证解码后的数据
      const decodedArray = new Uint8Array(decoded!.data);
      expect(decodedArray.byteLength).toBe(CHUNK_SIZE);
      for (let i = 0; i < CHUNK_SIZE; i++) {
        expect(decodedArray[i]).toBe(originalData[i]);
      }

      // 验证 CRC32
      const decodedCrc = crc32(decoded!.data);
      expect(decodedCrc).toBe(originalCrc);
    });
  });

  describe("场景 9: 多分块完整文件传输模拟", () => {
    it("完整文件：多分块编解码、CRC32 逐块校验、SHA256 完整性", async () => {
      // 模拟一个 64KB 文件（4 个分块）
      const FILE_SIZE = CHUNK_SIZE * 4; // 65536 bytes
      const fileData = new Uint8Array(FILE_SIZE);
      for (let i = 0; i < FILE_SIZE; i++) {
        fileData[i] = (i * 3 + 7) % 256;
      }

      const fileId = "e2e-file-complete";
      const totalChunks = Math.ceil(FILE_SIZE / CHUNK_SIZE);

      // --- 发送端 ---
      // 1. 计算原始 SHA256
      const originalHash = await crypto.subtle.digest("SHA-256", fileData.buffer);
      const originalHashHex = Array.from(new Uint8Array(originalHash))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");

      // 2. 逐块编码（模拟发送）
      const encodedChunks: ArrayBuffer[] = [];
      const crc32Values: number[] = [];

      for (let i = 0; i < totalChunks; i++) {
        const start = i * CHUNK_SIZE;
        const end = Math.min(start + CHUNK_SIZE, FILE_SIZE);
        const chunk = fileData.slice(start, end);
        const chunkCrc = crc32(chunk.buffer);
        crc32Values.push(chunkCrc);
        encodedChunks.push(encodeChunk(fileId, i, chunkCrc, chunk.buffer));
      }

      // --- 接收端 ---
      // 3. 逐块解码并验证 CRC32
      const receivedChunks = new Array<Uint8Array | null>(totalChunks).fill(null);

      for (let i = 0; i < totalChunks; i++) {
        const decoded = decodeChunk(encodedChunks[i]);
        expect(decoded).not.toBeNull();
        expect(decoded!.fileId).toBe(fileId);
        expect(decoded!.chunkIndex).toBe(i);

        // CRC32 逐块校验
        const computedCrc = crc32(decoded!.data);
        expect(computedCrc).toBe(crc32Values[i]);

        receivedChunks[i] = new Uint8Array(decoded!.data);
      }

      // 4. 组装完整文件
      const assembledFile = new Uint8Array(FILE_SIZE);
      let offset = 0;
      for (let i = 0; i < totalChunks; i++) {
        const chunk = receivedChunks[i]!;
        assembledFile.set(chunk, offset);
        offset += chunk.byteLength;
      }

      // 5. SHA256 完整性校验
      const receivedHash = await crypto.subtle.digest("SHA-256", assembledFile.buffer);
      const receivedHashHex = Array.from(new Uint8Array(receivedHash))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");

      // ✅ 校验通过
      expect(receivedHashHex).toBe(originalHashHex);
      expect(assembledFile).toEqual(fileData);
    });
  });

  describe("场景 10: CRC32 错误检测", () => {
    it("CRC32 不匹配时接收端应检测到损坏数据", () => {
      const originalData = new Uint8Array(CHUNK_SIZE);
      for (let i = 0; i < CHUNK_SIZE; i++) originalData[i] = i % 256;

      const fileId = "e2e-file-crc-test";
      const correctCrc = crc32(originalData.buffer);

      // 编码（使用正确的 CRC32）
      const encoded = encodeChunk(fileId, 0, correctCrc, originalData.buffer);

      // 解码
      const decoded = decodeChunk(encoded);
      expect(decoded).not.toBeNull();

      // 模拟数据损坏：修改解码后的数据
      const corrupted = new Uint8Array(decoded!.data);
      corrupted[0] = (corrupted[0] + 1) % 256; // 翻转 1 字节

      // CRC32 校验应不匹配
      const corruptedCrc = crc32(corrupted.buffer);
      expect(corruptedCrc).not.toBe(correctCrc);
    });
  });
});

// ============================================================
// 4. 配对流程 E2E 测试
// ============================================================

describe("🤝 E2E — 配对流程：配对码 + 扫码", () => {
  let pairingService: PairingService;

  beforeEach(() => {
    vi.clearAllMocks();
    pairingService = new PairingService();
  });

  describe("场景 11: 配对码创建与加入", () => {
    it("创建配对码 → 另一设备用配对码加入 → 配对成功", () => {
      // 设备 A（桌面端）创建配对码
      const result = pairingService.createPairingCode("e2e-device-mac");
      expect(result.code).toMatch(/^\d{6}$/);
      expect(result.roomId).toBeTruthy();
      expect(result.expiresAt.getTime()).toBeGreaterThan(Date.now());

      // 验证不是弱密码
      const weakCodes = ["000000", "111111", "123456", "654321"];
      expect(weakCodes).not.toContain(result.code);

      // 设备 B（手机端）用配对码加入
      const joinResult = pairingService.joinByCode(result.code, "e2e-device-iphone");

      expect("error" in joinResult).toBe(false);
      if (!("error" in joinResult)) {
        expect(joinResult.roomId).toBe(result.roomId);
        expect(joinResult.creatorDeviceId).toBe("e2e-device-mac");
      }
    });

    it("无效配对码 → 拒绝", () => {
      const result = pairingService.joinByCode("999999", "e2e-device-iphone");
      expect("error" in result).toBe(true);
      if ("error" in result) {
        expect(result.error).toContain("无效");
      }
    });

    it("重复使用配对码 → 拒绝", () => {
      const { code } = pairingService.createPairingCode("e2e-device-mac");
      pairingService.joinByCode(code, "e2e-device-iphone");

      // 再次使用同一配对码
      const result = pairingService.joinByCode(code, "e2e-device-other");
      expect("error" in result).toBe(true);
      if ("error" in result) {
        expect(result.error).toContain("已被使用");
      }
    });

    it("自己配对自己 → 拒绝", () => {
      const { code } = pairingService.createPairingCode("e2e-device-mac");
      const result = pairingService.joinByCode(code, "e2e-device-mac");
      expect("error" in result).toBe(true);
      if ("error" in result) {
        expect(result.error).toContain("自己的设备");
      }
    });
  });

  describe("场景 12: 扫码配对", () => {
    it("创建扫码配对 → 对方通过 room_id 加入", () => {
      const qrResult = pairingService.createQRPairing("e2e-device-mac");
      expect(qrResult.qrData).toContain("quickdrop_pairing");
      expect(qrResult.roomId).toBeTruthy();

      // 解析二维码数据
      const qrParsed = JSON.parse(qrResult.qrData);
      expect(qrParsed.type).toBe("quickdrop_pairing");
      expect(qrParsed.room_id).toBe(qrResult.roomId);
      expect(qrParsed.expires_at).toBeTruthy();

      // 对方通过 room_id 加入
      const joinResult = pairingService.joinByRoom(qrResult.roomId, "e2e-device-iphone");
      expect("error" in joinResult).toBe(false);
      if (!("error" in joinResult)) {
        expect(joinResult.creatorDeviceId).toBe("e2e-device-mac");
      }
    });

    it("过期配对码 → 拒绝", () => {
      // 使用已过期的 room（手动构造过期房间）
      const { roomId } = pairingService.createQRPairing("e2e-device-mac");

      // 直接操作内部 map 模拟过期（仅测试用）
      const roomsMap = (pairingService as unknown as { rooms: Map<string, { expiresAt: Date }> }).rooms;
      const room = roomsMap.get(roomId);
      if (room) {
        room.expiresAt = new Date(Date.now() - 1000); // 已过期
      }

      const result = pairingService.joinByRoom(roomId, "e2e-device-iphone");
      expect("error" in result).toBe(true);
      if ("error" in result) {
        expect(result.error).toContain("过期");
      }
    });
  });
});

// ============================================================
// 5. 密码重置 E2E 测试
// ============================================================

describe("🔑 E2E — 密码重置流程：忘记密码 → 发送邮件 → 重置", () => {
  let authService: AuthService;

  beforeEach(() => {
    vi.clearAllMocks();
    authService = new AuthService();
  });

  describe("场景 13: 请求密码重置", () => {
    it("已注册邮箱 → 返回成功消息（不泄露用户是否存在）", async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: "e2e-user-001",
        email: "test@quickdrop.dev",
        isLocked: false,
        lockedUntil: null,
      });

      mockPrisma.passwordResetToken.updateMany.mockResolvedValue({ count: 0 });
      mockPrisma.passwordResetToken.create.mockResolvedValue({
        id: "reset-001",
        userId: "e2e-user-001",
        tokenHash: expect.any(String),
        expiresAt: new Date(Date.now() + 15 * 60 * 1000),
        used: false,
        createdAt: new Date(),
      });

      const result = await authService.requestPasswordReset("test@quickdrop.dev");

      expect(result.message).toContain("如果该邮箱已注册");
      expect(mockPrisma.passwordResetToken.create).toHaveBeenCalled();
    });

    it("未注册邮箱 → 返回相同成功消息（防枚举）", async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      const result = await authService.requestPasswordReset("unknown@quickdrop.dev");

      expect(result.message).toContain("如果该邮箱已注册");
      // 不应尝试创建重置令牌
      expect(mockPrisma.passwordResetToken.create).not.toHaveBeenCalled();
    });

    it("已锁定账户 → 返回相同消息不发送邮件", async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: "e2e-user-001",
        email: "locked@quickdrop.dev",
        isLocked: true,
        lockedUntil: new Date(Date.now() + 10 * 60 * 1000), // 10 分钟后解锁
      });

      const result = await authService.requestPasswordReset("locked@quickdrop.dev");

      expect(result.message).toContain("如果该邮箱已注册");
      // 锁定账户不应生成重置令牌
      expect(mockPrisma.passwordResetToken.create).not.toHaveBeenCalled();
    });

    it("请求重置时清除旧的未使用令牌", async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: "e2e-user-001",
        email: "test@quickdrop.dev",
        isLocked: false,
        lockedUntil: null,
      });

      mockPrisma.passwordResetToken.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.passwordResetToken.create.mockResolvedValue({
        id: "reset-002",
        userId: "e2e-user-001",
        tokenHash: "hashed-token",
        expiresAt: new Date(Date.now() + 15 * 60 * 1000),
        used: false,
        createdAt: new Date(),
      });

      await authService.requestPasswordReset("test@quickdrop.dev");

      // 应标记旧令牌为已使用
      expect(mockPrisma.passwordResetToken.updateMany).toHaveBeenCalledWith({
        where: { userId: "e2e-user-001", used: false },
        data: { used: true },
      });
    });
  });

  describe("场景 14: 使用重置令牌重置密码", () => {
    it("有效令牌 → 密码重置成功 → 撤销所有会话", async () => {
      const mockUser = {
        id: "e2e-user-001",
        email: "test@quickdrop.dev",
        passwordHash: "$2b$12$oldhash...",
        isLocked: true,
        failedLoginAttempts: 5,
        lockedUntil: new Date(Date.now() + 10 * 60 * 1000),
      };

      mockPrisma.passwordResetToken.findUnique.mockResolvedValue({
        id: "reset-001",
        userId: "e2e-user-001",
        tokenHash: expect.any(String), // SHA-256 of the raw token
        expiresAt: new Date(Date.now() + 10 * 60 * 1000), // valid
        used: false,
        createdAt: new Date(),
        user: mockUser,
      });

      mockPrisma.user.update.mockResolvedValue({
        ...mockUser,
        passwordHash: "$2b$12$newhash...",
        isLocked: false,
        failedLoginAttempts: 0,
        lockedUntil: null,
      });

      mockPrisma.passwordResetToken.update.mockResolvedValue({
        id: "reset-001",
        used: true,
      });

      mockPrisma.refreshToken.updateMany.mockResolvedValue({ count: 2 });
      mockPrisma.device.updateMany.mockResolvedValue({ count: 2 });

      const result = await authService.resetPassword("valid-raw-token-123", "NewPass123");

      expect(result.message).toContain("密码重置成功");

      // 验证密码已更新
      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: "e2e-user-001" },
        data: expect.objectContaining({
          isLocked: false,
          failedLoginAttempts: 0,
        }),
      });

      // 验证令牌已标记使用
      expect(mockPrisma.passwordResetToken.update).toHaveBeenCalledWith({
        where: { id: "reset-001" },
        data: { used: true },
      });

      // 验证所有会话被撤销
      expect(mockPrisma.refreshToken.updateMany).toHaveBeenCalledWith({
        where: { userId: "e2e-user-001", revoked: false },
        data: { revoked: true },
      });

      // 验证所有设备标记离线
      expect(mockPrisma.device.updateMany).toHaveBeenCalledWith({
        where: { userId: "e2e-user-001" },
        data: { isOnline: false },
      });
    });

    it("无效令牌 → 抛出错误", async () => {
      mockPrisma.passwordResetToken.findUnique.mockResolvedValue(null);

      await expect(
        authService.resetPassword("invalid-token", "NewPass123"),
      ).rejects.toThrow("无效的重置令牌");
    });

    it("已使用的令牌 → 抛出错误", async () => {
      mockPrisma.passwordResetToken.findUnique.mockResolvedValue({
        id: "reset-001",
        userId: "e2e-user-001",
        tokenHash: expect.any(String),
        expiresAt: new Date(Date.now() + 10 * 60 * 1000),
        used: true, // 已使用
        createdAt: new Date(),
        user: {
          id: "e2e-user-001",
          email: "test@quickdrop.dev",
        },
      });

      await expect(
        authService.resetPassword("used-token", "NewPass123"),
      ).rejects.toThrow("已使用");
    });

    it("已过期的令牌 → 抛出错误", async () => {
      mockPrisma.passwordResetToken.findUnique.mockResolvedValue({
        id: "reset-001",
        userId: "e2e-user-001",
        tokenHash: expect.any(String),
        expiresAt: new Date(Date.now() - 1000), // 已过期
        used: false,
        createdAt: new Date(),
        user: {
          id: "e2e-user-001",
          email: "test@quickdrop.dev",
        },
      });

      await expect(
        authService.resetPassword("expired-token", "NewPass123"),
      ).rejects.toThrow("已过期");
    });
  });
});

// ============================================================
// 5. 常量校验
// ============================================================

describe("📋 E2E — 系统常量校验", () => {
  it("CHUNK_SIZE 应为 16384 (16KB)", () => {
    expect(CHUNK_SIZE).toBe(16384);
  });

  it("MAX_PARALLEL_TRANSFERS 应为 5", () => {
    expect(MAX_PARALLEL_TRANSFERS).toBe(5);
  });

  it("MAX_RETRY_COUNT 应为 3", () => {
    expect(MAX_RETRY_COUNT).toBe(3);
  });

  it("CRC32 查找表校验（与 zlib/gzip 兼容）", () => {
    // 使用标准测试向量验证 CRC32
    const testData = new TextEncoder().encode("123456789");
    const result = crc32(testData.buffer);
    // 标准 CRC-32/IEEE 对 "123456789" 的校验值
    expect(result).toBe(0xcbf43926);
  });
});
