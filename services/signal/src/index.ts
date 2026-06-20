// ============================================================
// QuickDrop 信令服务 — 入口文件
// WebSocket 服务: 设备管理、配对、WebRTC 信令转发
// ============================================================

import { WebSocketServer } from "ws";
import dotenv from "dotenv";
import { createServer } from "http";
import { authenticateWebSocket } from "./middleware/authMiddleware.js";
import { handleConnection } from "./handlers/connectionHandler.js";

dotenv.config();

const PORT = parseInt(process.env.PORT || "3002", 10);

// HTTP 服务（健康检查）
const httpServer = createServer((_req, res) => {
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ status: "ok", service: "signal", timestamp: new Date().toISOString() }));
});

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
});

export { wss };
