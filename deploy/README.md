# QuickDrop 生产环境部署指南

## 架构概览

```
                     Internet
                        │
                   ┌────▼────┐
                   │  Nginx  │  HTTPS 终止 + 反向代理
                   └────┬────┘
                        │
          ┌─────────────┼─────────────┐
          │             │             │
     ┌────▼────┐  ┌────▼────┐  ┌────▼────┐
     │  Auth   │  │ Signal  │  │ 静态文件 │
     │ :3001   │  │ :3002   │  │ (Web UI) │
     └────┬────┘  └────┬────┘  └─────────┘
          │             │
     ┌────▼────┐  ┌────▼────┐
     │PostgreSQL│  │  Redis  │
     └─────────┘  └─────────┘

外部依赖:
  ┌──────────┐
  │  Coturn  │  STUN/TURN 服务器（NAT 穿透）
  └──────────┘
```

## 端口规划

| 端口 | 服务 | 协议 | 说明 |
|------|------|------|------|
| 80 | Nginx | HTTP | ACME 验证 + 重定向到 HTTPS |
| 443 | Nginx | HTTPS | API + WebSocket (WSS) + 静态文件 |
| 3478 | Coturn | TCP/UDP | STUN / TURN |
| 5349 | Coturn | TCP/UDP | STUN / TURN (TLS) |
| 49152-65535 | Coturn | UDP | TURN 中继端口范围 |
| 5432 | PostgreSQL | TCP | 仅 127.0.0.1 绑定 |
| 6379 | Redis | TCP | 仅 127.0.0.1 绑定 |

## 部署前准备

### 1. 服务器要求

- **CPU**: 2 核+
- **内存**: 2GB+（推荐 4GB）
- **磁盘**: 20GB+
- **操作系统**: Ubuntu 22.04 LTS 或更新
- **公网 IP**: 必需，用于 STUN/TURN 和客户端连接
- **域名**: 推荐配置（用于 HTTPS 证书）

### 2. 安装 Docker

```bash
# Ubuntu / Debian
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
# 重新登录使权限生效

# 安装 Docker Compose v2
sudo apt install docker-compose-plugin
```

### 3. 防火墙配置

```bash
# 必需端口
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw allow 3478
sudo ufw allow 3478/udp
sudo ufw allow 5349
sudo ufw allow 5349/udp
sudo ufw allow 49152:65535/udp

# 可选：限制 SSH 访问
sudo ufw allow 22/tcp
sudo ufw enable
```

### 4. 内核参数调优

```bash
# /etc/sysctl.d/99-quickdrop.conf
net.core.somaxconn = 4096
net.ipv4.tcp_max_syn_backlog = 4096
net.ipv4.ip_local_port_range = 1024 65535
net.ipv4.tcp_tw_reuse = 1
fs.file-max = 2097152

# 应用
sudo sysctl -p /etc/sysctl.d/99-quickdrop.conf
```

## 快速部署

### 1. 克隆项目

```bash
git clone <repo-url> quickdrop
cd quickdrop
```

### 2. 配置环境变量

```bash
cp deploy/.env.example deploy/.env
# 编辑 deploy/.env，修改所有 CHANGE_ME 占位符
nano deploy/.env
```

**必须修改的变量**:
- `POSTGRES_PASSWORD` — 数据库密码
- `JWT_ACCESS_SECRET` — 至少 64 字符随机字符串
- `JWT_REFRESH_SECRET` — 至少 64 字符随机字符串
- `SMTP_*` — 邮件服务配置（可选，密码重置功能需要）

生成安全密钥:
```bash
openssl rand -base64 64  # 用于 JWT 密钥
```

### 3. 配置 TURN 服务器

编辑 `deploy/coturn/turnserver.conf`，确保以下配置正确:

```ini
# 替换为服务器公网 IP
external-ip=<YOUR_PUBLIC_IP>

# 替换为您的域名（如果有）
realm=quickdrop.app

# 替换认证密码
static-auth-secret=<YOUR_TURN_SECRET>
```

### 4. 配置 Nginx

编辑 `deploy/nginx/nginx.conf`，替换 `server_name _` 为您的域名:

```nginx
server_name quickdrop.app;
```

### 5. 启动服务

```bash
# 构建镜像
docker compose -f deploy/docker-compose.yml --env-file deploy/.env build

# 启动所有服务
docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d

# 查看日志
docker compose -f deploy/docker-compose.yml logs -f
```

### 6. 数据库迁移

```bash
# 首次部署或 schema 变更后执行
docker compose -f deploy/docker-compose.yml exec auth npx prisma migrate deploy
```

### 7. HTTPS 证书（Let's Encrypt）

```bash
# 首次申请证书
docker compose -f deploy/docker-compose.yml run --rm certbot certonly \
  --webroot --webroot-path=/var/www/certbot \
  --email admin@quickdrop.app \
  --agree-tos --no-eff-email \
  -d quickdrop.app -d www.quickdrop.app

# 证书自动续期（certbot 容器每 12 小时检查一次）
```

## 验证部署

```bash
# 健康检查
curl -k https://localhost/health
# 预期: {"status":"ok","service":"auth","timestamp":"..."}

# 信令服务
curl -k https://localhost/signal/
# 预期: {"status":"ok","service":"signal","timestamp":"..."}

# 查看运行状态
docker compose -f deploy/docker-compose.yml ps
```

## 运维命令

### 查看日志

```bash
# 所有服务
docker compose -f deploy/docker-compose.yml logs -f --tail=100

# 特定服务
docker compose -f deploy/docker-compose.yml logs -f auth
docker compose -f deploy/docker-compose.yml logs -f signal
docker compose -f deploy/docker-compose.yml logs -f nginx
```

### 重启服务

```bash
# 重启单个服务
docker compose -f deploy/docker-compose.yml restart auth
docker compose -f deploy/docker-compose.yml restart signal

# 重启全部
docker compose -f deploy/docker-compose.yml restart
```

### 升级部署

```bash
# 拉取最新代码
git pull

# 重新构建并部署
docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d --build

# 执行数据库迁移（如有变更）
docker compose -f deploy/docker-compose.yml exec auth npx prisma migrate deploy
```

### 备份数据库

```bash
# 导出
docker compose -f deploy/docker-compose.yml exec postgres \
  pg_dump -U quickdrop quickdrop > backup_$(date +%Y%m%d).sql

# 恢复
docker compose -f deploy/docker-compose.yml exec -T postgres \
  psql -U quickdrop quickdrop < backup_20260621.sql
```

### 资源监控

```bash
# 容器资源使用
docker stats quickdrop-auth quickdrop-signal quickdrop-postgres quickdrop-redis quickdrop-nginx

# 磁盘使用
docker system df
```

## 安全清单

- [ ] 修改所有默认密码和密钥（`CHANGE_ME` 占位符）
- [ ] JWT 密钥使用 `openssl rand -base64 64` 生成
- [ ] 防火墙仅开放必要端口（80, 443, 3478, 5349, 49152-65535）
- [ ] PostgreSQL 和 Redis 仅绑定 127.0.0.1
- [ ] 启用 HTTPS + HSTS
- [ ] 配置日志轮转（已内置 docker json-file 日志限制）
- [ ] 定期更新基础镜像（`docker compose pull`）
- [ ] 设置数据库定期备份 cron job
- [ ] 配置监控告警（推荐 Prometheus + Grafana）

## 扩展：多实例部署

当单机无法满足需求时，可扩展为多实例部署:

```yaml
# 信令服务可水平扩展（需在 Nginx upstream 中添加更多实例）
signal-2:
  build: ...
  environment: ...

# 使用外部 Redis 和 PostgreSQL（云服务）
# 使用 Docker Swarm 或 Kubernetes 编排
```

信令服务的水平扩展注意事项:
- 使用 Redis Pub/Sub 跨节点同步设备状态
- Nginx `ip_hash` 或 `sticky` 确保同一设备连接同一节点
- TURN 服务器独立部署

## 故障排查

### WebSocket 连接失败
1. 检查 Nginx 是否正确配置 `Upgrade` 和 `Connection` 头
2. 检查防火墙是否开放 443 端口
3. 查看 `docker compose logs signal` 确认服务正常运行

### 设备间无法建立 P2P 连接
1. 检查 Coturn 是否正确运行：`docker compose logs coturn`
2. 确认防火墙开放 UDP 3478 和 49152-65535
3. 使用 [WebRTC 测试工具](https://webrtc.github.io/samples/src/content/peerconnection/trickle-ice/) 验证 TURN 服务器可用性

### 数据库连接失败
1. 检查 `DATABASE_URL` 环境变量是否正确
2. 确认 PostgreSQL 已启动：`docker compose ps postgres`
3. 检查认证密码是否匹配
