# ============================================================
# QuickDrop 认证服务 — 生产环境 Dockerfile
# 构建上下文: 仓库根目录
# 使用: docker build -f services/auth/Dockerfile -t quickdrop-auth .
# ============================================================

# ---- 构建阶段 ----
FROM node:22-alpine AS builder

# 保持 monorepo 目录结构（相对路径导入需要）
WORKDIR /build

# 复制 shared（auth 通过 ../../../../shared/ 引用）
COPY shared/ ./shared/

# 复制 auth 依赖配置
COPY services/auth/package.json services/auth/package-lock.json* ./services/auth/

# 安装全部依赖（含 devDeps，用于 tsc 编译）
WORKDIR /build/services/auth
RUN npm ci

# 复制 auth 源码
COPY services/auth/tsconfig.json ./
COPY services/auth/src/ ./src/
COPY services/auth/prisma/ ./prisma/

# 编译 TypeScript（rootDir="../../" → 输出到 dist/services/auth/src/）
RUN npx tsc

# 生成 Prisma Client
RUN npx prisma generate

# ---- 运行阶段 ----
FROM node:22-alpine AS runner

# 保持相同的目录结构
WORKDIR /app

# 复制 shared（运行时可能需要类型定义）
COPY shared/ ./shared/

# 复制 auth 依赖配置并安装仅生产依赖
COPY services/auth/package.json services/auth/package-lock.json* ./services/auth/
WORKDIR /app/services/auth
RUN npm ci --omit=dev

# 从构建阶段复制编译产物
COPY --from=builder /build/services/auth/dist/ ./dist/

# 复制 Prisma 生成的客户端（在 node_modules 中）
COPY --from=builder /build/services/auth/node_modules/.prisma/ ./node_modules/.prisma/
COPY --from=builder /build/services/auth/node_modules/@prisma/ ./node_modules/@prisma/

# 复制 Prisma schema（用于运行时迁移）
COPY --from=builder /build/services/auth/prisma/ ./prisma/

# 安全加固
RUN addgroup -S quickdrop && adduser -S quickdrop -G quickdrop
USER quickdrop

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3001/health || exit 1

# rootDir="../../" 的 tsc 输出: dist/services/auth/src/index.js
CMD ["node", "dist/services/auth/src/index.js"]
