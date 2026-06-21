# ============================================================
# QuickDrop 信令服务 — 生产环境 Dockerfile
# 构建上下文: 仓库根目录
# 使用: docker build -f services/signal/Dockerfile -t quickdrop-signal .
# ============================================================

# ---- 构建阶段 ----
FROM node:22-alpine AS builder

# 保持 monorepo 目录结构
WORKDIR /build

# 复制 shared（signal 通过 ../../../../shared/ 引用）
COPY shared/ ./shared/

# 复制 signal 依赖配置
COPY services/signal/package.json services/signal/package-lock.json* ./services/signal/

# 安装全部依赖（含 devDeps，用于 tsc 编译）
WORKDIR /build/services/signal
RUN npm ci

# 复制 signal 源码
COPY services/signal/tsconfig.json ./
COPY services/signal/src/ ./src/

# 编译 TypeScript
RUN npx tsc

# ---- 运行阶段 ----
FROM node:22-alpine AS runner

# 保持相同的目录结构
WORKDIR /app

# 复制 shared
COPY shared/ ./shared/

# 复制 signal 依赖配置并安装仅生产依赖
COPY services/signal/package.json services/signal/package-lock.json* ./services/signal/
WORKDIR /app/services/signal
RUN npm ci --omit=dev

# 从构建阶段复制编译产物
COPY --from=builder /build/services/signal/dist/ ./dist/

# 安全加固
RUN addgroup -S quickdrop && adduser -S quickdrop -G quickdrop
USER quickdrop

EXPOSE 3002

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3002/ || exit 1

# rootDir="../../" 的 tsc 输出: dist/services/signal/src/index.js
CMD ["node", "dist/services/signal/src/index.js"]
