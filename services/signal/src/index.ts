// ============================================================
// QuickDrop 信令服务 — 入口文件
// WebSocket 服务: 设备管理、配对、WebRTC 信令转发
// HTTP 端点: 健康检查、force_logout 推送
// ============================================================

import { WebSocketServer } from "ws";
import dotenv from "dotenv";
import { createServer, IncomingMessage, ServerResponse } from "http";
import { authenticateWebSocket } from "./middleware/authMiddleware.js";
import { handleConnection } from "./handlers/connectionHandler.js";
import { deviceManager } from "./services/deviceManager.js";

dotenv.config();

const PORT = parseInt(process.env.PORT || "3002", 10);

/**
 * 简单的 HTTP 路由器
 */
function handleHttpRequest(req: IncomingMessage, res: ServerResponse): void {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

  // 健康检查
  if (req.method === "GET" && url.pathname === "/") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", service: "signal", timestamp: new Date().toISOString() }));
    return;
  }

  // GET /stats — 连接监控统计（供管理后台使用）
  if (req.method === "GET" && url.pathname === "/stats") {
    const onlineDeviceCount = deviceManager.onlineCount;
    const userDevices = deviceManager.getStatsByUser?.() ?? { total_users: 0, devices_per_user: {} };

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        online_devices: onlineDeviceCount,
        unique_users: Object.keys(userDevices.devices_per_user || {}).length,
        timestamp: new Date().toISOString(),
      }),
    );
    return;
  }

  // POST /force-logout — 接收来自认证服务的强制下线请求
  if (req.method === "POST" && url.pathname === "/force-logout") {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      try {
        const { device_id } = JSON.parse(body);
        if (!device_id) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "缺少 device_id" }));
          return;
        }

        const sent = deviceManager.sendToDevice(device_id, {
          type: "force_logout",
          payload: { reason: "device_removed" },
          timestamp: new Date().toISOString(),
        });

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: true, delivered: sent }));
      } catch {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "无效的 JSON 请求体" }));
      }
    });
    return;
  }

  // 404
  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "未找到" }));
}

// HTTP 服务
const httpServer = createServer(handleHttpRequest);

// WebSocket 服务
const wss = new WebSocketServer({ server: httpServer });

wss.on("connection", async (ws, req) => {
  try {
    // JWT 认证握手
    const payload = await authenticateWebSocket(req);
    if (!payload) {
      ws.close(4001, "认证失败: 无效或缺失 Token");
      return;
    }

    console.log(`📶 Device ${payload.device_id} (user: ${payload.sub}) connected`);

    // 委托给连接处理器
    handleConnection(ws, payload);
  } catch (err) {
    console.error("WebSocket connection error:", err);
    ws.close(4000, "服务器内部错误");
  }
});

wss.on("error", (err) => {
  console.error("WebSocket server error:", err);
});

httpServer.listen(PORT, () => {
  console.log(`📶 Signal service running on ws://localhost:${PORT}`);
  console.log(`   Health check: http://localhost:${PORT}/`);
  console.log(`   Force logout: POST http://localhost:${PORT}/force-logout`);
});

export { wss };
