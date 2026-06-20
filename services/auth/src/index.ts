// ============================================================
// QuickDrop 认证服务 — 入口文件
// RESTful API 服务: 用户注册/登录、Token 管理、设备会话管理
// ============================================================

import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { authRouter } from "./routes/auth.js";
import { deviceRouter } from "./routes/device.js";
import { errorHandler } from "./middleware/errorHandler.js";
import {
  httpsRedirect,
  hsts,
  securityHeaders,
} from "./middleware/securityHeaders.js";

dotenv.config();

const app = express();
const PORT = parseInt(process.env.PORT || "3001", 10);

// ---------- 信任代理（生产环境必需，用于获取真实客户端 IP）----------
if (process.env.NODE_ENV === "production") {
  app.set("trust proxy", 1);
}

// ---------- 全局中间件 ----------
// 安全头部（CSP、XSS 防护、HSTS 等）
app.use(securityHeaders);
app.use(hsts);
// HTTPS 强制重定向（生产环境）
app.use(httpsRedirect);
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: "1mb" }));

// ---------- 健康检查 ----------
app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "auth", timestamp: new Date().toISOString() });
});

// ---------- 路由 ----------
app.use("/api/v1/auth", authRouter);
app.use("/api/v1/devices", deviceRouter);

// ---------- 错误处理 ----------
app.use(errorHandler);

// ---------- 启动 ----------
app.listen(PORT, () => {
  console.log(`🔐 Auth service running on http://localhost:${PORT}`);
  console.log(`   Health check: http://localhost:${PORT}/health`);
});

export { app };
