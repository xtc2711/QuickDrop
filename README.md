# QuickDrop

> 跨平台的 AirDrop — 覆盖 Windows / macOS / Android / iOS 的点对点文件传输工具

## 特性

- **无损传输**: 原始二进制流，SHA256 完整性校验，不压缩、不修改
- **自动配对**: 同账户设备自动发现并建立 P2P 连接
- **智能通道**: 蓝牙/热点 → 局域网 P2P → TURN 中继，自动选择最优路径
- **无大小限制**: 支持 10GB+ 大文件传输
- **零配置**: 登录后自动完成设备发现，无需手动配对

## 项目结构

```
quickdrop/
├── services/
│   ├── auth/       # 认证服务 (REST API + JWT + PostgreSQL)
│   └── signal/     # 信令服务 (WebSocket + WebRTC 信令转发)
├── desktop/        # 桌面客户端 (Tauri + React + TypeScript)
├── shared/         # 共享类型和工具函数
└── docker-compose.yml
```

## 快速开始

```bash
# 启动数据库
docker compose up -d postgres redis

# 安装依赖
cd services/auth && npm install && npx prisma generate && npx prisma migrate dev --name init
cd services/signal && npm install
cd desktop && npm install

# 启动服务
cd services/auth && npm run dev    # http://localhost:3001
cd services/signal && npm run dev  # ws://localhost:3002
cd desktop && npm run dev          # http://localhost:1420
```

## 技术栈

| 模块 | 技术 |
|------|------|
| 认证服务 | Node.js + Express + Prisma + PostgreSQL + Redis + JWT |
| 信令服务 | Node.js + WebSocket (ws) + Redis |
| 桌面客户端 | Tauri + React + TypeScript + Vite |
| P2P 传输 | WebRTC DataChannel + SCTP |
| NAT 穿透 | STUN/TURN (coturn) |
| 密码安全 | bcrypt (cost=12) |