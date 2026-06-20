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

## Key Learnings
- 项目采用 monorepo 结构，shared/ 目录被 auth、signal、desktop 三个包共享
- Prisma 用于 PostgreSQL ORM，生成客户端后 tsc 才能通过
- 信令服务的 WebSocket 通过 URL query string 携带 JWT Token 认证
- 桌面端 Tauri 的 devUrl 指向 Vite 开发服务器 (localhost:1420)
- bcrypt cost=12 必须严格执行（product spec）
- TSConfig rootDir 设置为 monorepo 根以保证 shared/ 能被引用
