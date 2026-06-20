// ============================================================
// 信令服务 — 设备管理器单元测试
// 覆盖：设备注册/注销、用户索引、心跳检测、消息广播/单播
// ============================================================

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { DeviceManager } from "../src/services/deviceManager.js";
import { mockWebSocket } from "./setup.js";
import type { DeviceState } from "../src/models/types.js";

function createDeviceState(overrides: Partial<DeviceState> = {}): DeviceState {
  return {
    ws: mockWebSocket(),
    userId: "user-001",
    deviceId: "device-001",
    deviceName: "MacBook Pro",
    deviceType: "desktop",
    os: "macos",
    connectedAt: new Date(),
    lastHeartbeat: new Date(),
    isAlive: true,
    ...overrides,
  } as DeviceState;
}

describe("DeviceManager", () => {
  let dm: DeviceManager;

  beforeEach(() => {
    vi.useFakeTimers();
    dm = new DeviceManager();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ============================================================
  // register() — 设备注册上线
  // ============================================================
  describe("register()", () => {
    it("注册设备后应加入内部 Map 并更新用户索引", () => {
      const device = createDeviceState();
      dm.register(device);

      expect(dm.get("device-001")).toBe(device);
      expect(dm.onlineCount).toBe(1);
      expect(dm.getUserOnlineDevices("user-001")).toHaveLength(1);
    });

    it("注册新设备应向同账户其他在线设备广播 device_online", () => {
      // 先注册一个已有设备
      const existing = createDeviceState({ deviceId: "device-existing" });
      dm.register(existing);
      vi.clearAllMocks(); // 清除注册时产生的 send 调用

      // 再注册新设备
      const newDevice = createDeviceState({ deviceId: "device-new" });
      dm.register(newDevice);

      // 已有设备应收到 device_online 通知
      const sendCalls = vi.mocked(existing.ws.send).mock.calls;
      expect(sendCalls.length).toBeGreaterThanOrEqual(1);
      const msg = JSON.parse(sendCalls[0]?.[0] as string);
      expect(msg.type).toBe("device_online");
      expect(msg.payload.device_id).toBe("device-new");
    });

    it("新设备注册后应收到 device_list_update（包含同账户在线设备列表）", () => {
      // 先注册一个已有设备
      const existing = createDeviceState({ deviceId: "device-existing" });
      dm.register(existing);

      // 再注册新设备
      const newDevice = createDeviceState({ deviceId: "device-new" });
      dm.register(newDevice);

      // 新设备应收到 device_list_update
      const sendCalls = vi.mocked(newDevice.ws.send).mock.calls;
      const listMsg = sendCalls.find((call) => {
        const msg = JSON.parse(call[0] as string);
        return msg.type === "device_list_update";
      });
      expect(listMsg).toBeTruthy();
      const parsed = JSON.parse(listMsg![0] as string);
      expect(parsed.payload.online_devices).toHaveLength(1);
      expect(parsed.payload.online_devices[0].device_id).toBe("device-existing");
    });

    it("首个设备注册时应启动心跳检测定时器", () => {
      const device = createDeviceState();
      dm.register(device);

      // 推进时间触发心跳检测
      vi.advanceTimersByTime(200);
      // 心跳定时器应正常运行（设备未超时，不应被移除）
      expect(dm.get("device-001")).toBeDefined();
    });
  });

  // ============================================================
  // unregister() — 设备离线
  // ============================================================
  describe("unregister()", () => {
    it("注销设备应从 Map 中移除", () => {
      const device = createDeviceState();
      dm.register(device);

      dm.unregister("device-001");

      expect(dm.get("device-001")).toBeUndefined();
      expect(dm.onlineCount).toBe(0);
      expect(dm.getUserOnlineDevices("user-001")).toHaveLength(0);
    });

    it("注销设备应向同账户其他设备广播 device_offline", () => {
      const deviceA = createDeviceState({ deviceId: "device-a" });
      const deviceB = createDeviceState({ deviceId: "device-b", userId: "user-001" });
      dm.register(deviceA);
      dm.register(deviceB);
      vi.clearAllMocks();

      // 注销 device-a
      dm.unregister("device-a");

      // device-b 应收到 device_offline
      const sendCalls = vi.mocked(deviceB.ws.send).mock.calls;
      const offlineMsg = sendCalls.find((call) => {
        const msg = JSON.parse(call[0] as string);
        return msg.type === "device_offline";
      });
      expect(offlineMsg).toBeTruthy();
      const parsed = JSON.parse(offlineMsg![0] as string);
      expect(parsed.payload.device_id).toBe("device-a");
    });

    it("所有设备离线后应清理心跳定时器", () => {
      const device = createDeviceState();
      dm.register(device);

      dm.unregister("device-001");

      // 推进时间，心跳定时器应已清除
      vi.advanceTimersByTime(500);
      expect(dm.onlineCount).toBe(0);
    });
  });

  // ============================================================
  // getUserOnlineDevices() — 获取用户在线设备
  // ============================================================
  describe("getUserOnlineDevices()", () => {
    it("应返回指定用户的所有在线设备", () => {
      dm.register(createDeviceState({ deviceId: "d1", userId: "user-001" }));
      dm.register(createDeviceState({ deviceId: "d2", userId: "user-001" }));
      dm.register(createDeviceState({ deviceId: "d3", userId: "user-002" }));

      const user1Devices = dm.getUserOnlineDevices("user-001");
      expect(user1Devices).toHaveLength(2);
      expect(user1Devices.map((d) => d.deviceId).sort()).toEqual(["d1", "d2"]);
    });

    it("用户无在线设备时应返回空数组", () => {
      const devices = dm.getUserOnlineDevices("nonexistent-user");
      expect(devices).toEqual([]);
    });
  });

  // ============================================================
  // broadcastToUser() — 广播消息给用户所有设备
  // ============================================================
  describe("broadcastToUser()", () => {
    it("应向用户所有在线设备发送消息", () => {
      const d1 = createDeviceState({ deviceId: "d1", userId: "user-001" });
      const d2 = createDeviceState({ deviceId: "d2", userId: "user-001" });
      dm.register(d1);
      dm.register(d2);
      // 清除 register 产生的 device_list_update / device_online 调用记录
      vi.clearAllMocks();

      const message = { type: "test", payload: { hello: "world" } };
      dm.broadcastToUser("user-001", message);

      expect(d1.ws.send).toHaveBeenCalledTimes(1);
      expect(d2.ws.send).toHaveBeenCalledTimes(1);
      const sent = JSON.parse(vi.mocked(d1.ws.send).mock.calls[0]?.[0] as string);
      expect(sent.type).toBe("test");
    });

    it("排除指定设备时不应向其发送", () => {
      const d1 = createDeviceState({ deviceId: "d1", userId: "user-001" });
      const d2 = createDeviceState({ deviceId: "d2", userId: "user-001" });
      dm.register(d1);
      dm.register(d2);
      vi.clearAllMocks();

      dm.broadcastToUser("user-001", { type: "test" }, "d1");

      // d1 被排除，不应收到消息（register 的调用已清理）
      expect(d1.ws.send).not.toHaveBeenCalled();
      expect(d2.ws.send).toHaveBeenCalledTimes(1);
    });

    it("设备连接已关闭时不应尝试发送", () => {
      const closedWs = mockWebSocket(3); // WebSocket.CLOSED = 3
      dm.register(createDeviceState({ deviceId: "d1", ws: closedWs }));
      vi.clearAllMocks();

      dm.broadcastToUser("user-001", { type: "test" });

      expect(closedWs.send).not.toHaveBeenCalled();
    });
  });

  // ============================================================
  // sendToDevice() — 单播消息给指定设备
  // ============================================================
  describe("sendToDevice()", () => {
    it("应向指定设备发送消息并返回 true", () => {
      const device = createDeviceState();
      dm.register(device);
      vi.clearAllMocks(); // 清除 register 的 device_list_update 调用

      const result = dm.sendToDevice("device-001", { type: "hello" });

      expect(result).toBe(true);
      expect(device.ws.send).toHaveBeenCalledTimes(1);
      const sent = JSON.parse(vi.mocked(device.ws.send).mock.calls[0]?.[0] as string);
      expect(sent.type).toBe("hello");
    });

    it("设备不存在时应返回 false", () => {
      const result = dm.sendToDevice("nonexistent", { type: "hello" });
      expect(result).toBe(false);
    });

    it("设备连接已关闭时应返回 false", () => {
      const closedWs = mockWebSocket(3);
      dm.register(createDeviceState({ deviceId: "d1", ws: closedWs }));
      vi.clearAllMocks();

      const result = dm.sendToDevice("d1", { type: "hello" });

      expect(result).toBe(false);
      expect(closedWs.send).not.toHaveBeenCalled();
    });
  });

  // ============================================================
  // heartbeat() — 心跳更新
  // ============================================================
  describe("heartbeat()", () => {
    it("应更新设备的心跳时间戳", () => {
      const device = createDeviceState({
        lastHeartbeat: new Date(), // 使用 fake time 当前时间
      });
      dm.register(device);
      const oldTime = device.lastHeartbeat.getTime();

      // 推进时间（需 < HEARTBEAT_TIMEOUT_MS=200ms 以免被心跳检测断开）
      vi.advanceTimersByTime(100);
      dm.heartbeat("device-001");

      const updated = dm.get("device-001");
      expect(updated).toBeDefined();
      expect(updated!.lastHeartbeat.getTime()).toBeGreaterThan(oldTime);
      expect(updated!.isAlive).toBe(true);
    });
  });

  // ============================================================
  // 心跳超时检测
  // ============================================================
  describe("心跳超时检测", () => {
    it("超过 HEARTBEAT_TIMEOUT_MS 无心跳的设备应被断开", () => {
      const device = createDeviceState({
        lastHeartbeat: new Date(Date.now() - 1000), // 过去的
      });
      dm.register(device);

      // 推进时间使心跳超时
      vi.advanceTimersByTime(300); // 超过 HEARTBEAT_TIMEOUT_MS (200ms)

      // 设备应被 terminate
      expect(device.ws.terminate).toHaveBeenCalled();
      expect(dm.get("device-001")).toBeUndefined();
    });

    it("活跃心跳的设备不应被断开", () => {
      const device = createDeviceState({
        lastHeartbeat: new Date(Date.now()),
      });
      dm.register(device);

      // 推进时间但尚未超时
      vi.advanceTimersByTime(150);

      expect(device.ws.terminate).not.toHaveBeenCalled();
      expect(dm.get("device-001")).toBeDefined();
    });
  });

  // ============================================================
  // onlineCount — 在线设备数
  // ============================================================
  describe("onlineCount", () => {
    it("应正确返回在线设备总数", () => {
      expect(dm.onlineCount).toBe(0);

      dm.register(createDeviceState({ deviceId: "d1" }));
      expect(dm.onlineCount).toBe(1);

      dm.register(createDeviceState({ deviceId: "d2" }));
      expect(dm.onlineCount).toBe(2);

      dm.unregister("d1");
      expect(dm.onlineCount).toBe(1);
    });
  });
});
