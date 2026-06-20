# Agent Build Instructions

## QuickDrop 项目结构

```
quickdrop/
├── services/
│   ├── auth/          # 认证服务 (Node.js + Express + Prisma + JWT)
│   │   ├── src/       # 源码
│   │   ├── prisma/    # 数据库 schema
│   │   └── tests/     # 测试
│   └── signal/        # 信令服务 (Node.js + WebSocket)
│       ├── src/       # 源码
│       └── tests/     # 测试
├── desktop/           # 桌面客户端 (Tauri + React + TypeScript)
│   ├── src/           # Web 前端
│   └── src-tauri/     # Rust 后端
├── shared/            # 共享类型和工具函数
│   ├── types/         # TypeScript 接口定义
│   └── utils/         # 通用函数（校验、配对码生成等）
└── docker-compose.yml # PostgreSQL + Redis
```

## 环境准备

### 前置依赖
```bash
# 需要安装:
# - Node.js >= 20
# - PostgreSQL 16 (或 Docker)
# - Redis 7 (或 Docker)
# - Rust (用于 Tauri 桌面端，可选)
```

### 启动数据库（Docker）
```bash
docker compose up -d postgres redis
```

### 初始化环境变量
```bash
cp services/auth/.env.example services/auth/.env
cp services/signal/.env.example services/signal/.env
# 编辑 .env 文件修改密钥等配置
```

### 安装依赖
```bash
cd services/auth && npm install
cd services/signal && npm install
cd desktop && npm install
```

## 运行服务

### 数据库迁移（首次运行）
```bash
cd services/auth
npx prisma generate
npx prisma migrate dev --name init
```

### 启动认证服务
```bash
cd services/auth
npm run dev
# 服务启动在 http://localhost:3001
# 健康检查: http://localhost:3001/health
```

### 启动信令服务
```bash
cd services/signal
npm run dev
# WebSocket 服务启动在 ws://localhost:3002
# 健康检查: http://localhost:3002/
```

### 启动桌面客户端
```bash
cd desktop
npm run dev
# Vite dev server 启动在 http://localhost:1420
# Tauri: npm run tauri dev
```

## Running Tests
```bash
# 认证服务
cd services/auth && npx vitest run

# 信令服务
cd services/signal && npx vitest run

# 覆盖率
cd services/auth && npx vitest run --coverage
cd services/signal && npx vitest run --coverage
```

## TypeScript 检查
```bash
cd services/auth && npx tsc --noEmit
cd services/signal && npx tsc --noEmit
```

## 移动端项目

### Android (mobile/android/)
- Kotlin + WebView 架构，打开 Android Studio 即可构建
- 使用 Gradle 构建

### iOS (mobile/ios/)
- Swift + WKWebView 架构
- 需要完整 Xcode（非仅 Command Line Tools）才能编译
- 使用 XcodeGen 通过 `project.yml` 生成 `.xcodeproj`
- 扫码使用 Core Image CIDetector（无需 ML Kit）
- Token 存储使用 Keychain Services

## 安全配置

### 环境变量（生产环境必需）
```bash
NODE_ENV=production          # 启用 HTTPS 强制 + HSTS + 安全头部
JWT_ACCESS_SECRET=<random>   # JWT 签名密钥（禁止使用默认值）
JWT_REFRESH_SECRET=<random>  # Refresh Token 密钥
JWT_ACCESS_EXPIRES_IN=15m    # Access Token 有效期（默认 15 分钟）
JWT_REFRESH_EXPIRES_IN=30d   # Refresh Token 有效期（默认 30 天）
REDIS_URL=redis://...        # Redis 连接（可选，不配置则降级为内存存储）
```

### 安全中间件（自动启用）
- `securityHeaders`: CSP、XSS 防护、点击劫持防护、MIME 嗅探防护
- `hsts`: 生产环境自动设置 HSTS (max-age=31536000; includeSubDomains; preload)
- `httpsRedirect`: 生产环境根据 X-Forwarded-Proto 头自动重定向 HTTP → HTTPS
- `trust proxy`: 生产环境自动启用，确保速率限制获取真实客户端 IP

### 速率限制
| 接口 | 限制 |
|---|---|
| POST /api/v1/auth/login | 单 IP 每分钟 10 次 |
| POST /api/v1/auth/register | 单 IP 每小时 5 次 |
| 超限响应 | 429 + retry_after 秒数 |

## Key Learnings
- 项目采用 monorepo 结构，shared/ 目录被 auth、signal、desktop 三个包共享
- Prisma 用于 PostgreSQL ORM，生成客户端后 tsc 才能通过
- 信令服务的 WebSocket 通过 URL query string 携带 JWT Token 认证
- 桌面端 Tauri 的 devUrl 指向 Vite 开发服务器 (localhost:1420)
- bcrypt cost=12 必须严格执行（product spec）
- TSConfig rootDir 设置为 monorepo 根以保证 shared/ 能被引用
- 文件传输引擎使用 DataChannel 统一消息路由：字符串=控制消息，ArrayBuffer=分块数据
- CRC32 使用 IEEE 802.3 标准表驱动实现（验证通过：CRC32("123456789")=0xCBF43926）
- 流控使用 bufferedAmount 阈值 + ACK 窗口双机制防止接收端溢出
- SHA256 使用 Web Crypto API（crypto.subtle.digest），无需额外依赖
