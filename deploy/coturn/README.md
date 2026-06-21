# QuickDrop — STUN/TURN 服务器部署指南

## 概述

coturn 是 QuickDrop 的 NAT 穿透基础设施，提供：
- **STUN**: 帮助设备发现自己的公网 IP 和 NAT 类型（轻量，仅握手阶段）
- **TURN**: 当 P2P 直连失败时，作为中继回退（数据经过服务器）

```
设备 A ←→ STUN/TURN ←→ 设备 B
         (coturn)
```

## 前置要求

| 要求 | 说明 |
|------|------|
| 服务器 | 1 核 / 1GB RAM 最低（仅 STUN）；4 核 / 4GB RAM 推荐（TURN 中继） |
| 带宽 | TURN 中继流量会消耗服务器带宽，建议 ≥100Mbps |
| 公网 IP | 必须有独立公网 IPv4 地址 |
| 防火墙 | 开放 UDP 3478, UDP 49152-65535, TCP 3478, TCP 5349 |
| 域名 | 可选，建议 `turn.quickdrop.app`（SSL 证书需要） |

## 快速部署（Docker）

### 1. 生成共享密钥

```bash
openssl rand -hex 32
# 输出示例: a1b2c3d4e5f6...（64 字符十六进制）
```

### 2. 配置环境变量

创建 `.env` 文件：

```bash
# 服务器公网 IP
QD_TURN_EXTERNAL_IP=203.0.113.10

# 共享密钥（步骤 1 生成的）
QD_TURN_AUTH_SECRET=a1b2c3d4e5f6...

# Realm（与信令服务保持一致）
QD_TURN_REALM=quickdrop.app
```

### 3. 编辑 turnserver.conf

```bash
# 修改 external-ip 为实际公网 IP
sed -i 's/REPLACE_WITH_YOUR_PUBLIC_IP/203.0.1.10/' turnserver.conf

# 修改 static-auth-secret 为共享密钥
sed -i 's/REPLACE_WITH_SECRET_HEX_64_CHARS/a1b2c3d4.../' turnserver.conf
```

### 4. 启动服务

```bash
docker compose up -d
```

### 5. 验证

```bash
# 检查服务是否运行
docker compose ps

# 查看日志
docker compose logs -f coturn

# 使用 turnutils_uclient 测试（从容器内部）
docker compose exec coturn turnutils_uclient -v -W static-auth-secret=your-secret -u quickdrop:password -p 3478 127.0.0.1
```

## 无 Docker 部署（裸机）

### Ubuntu / Debian

```bash
# 安装
sudo apt update
sudo apt install -y coturn

# 编辑配置
sudo cp turnserver.conf /etc/turnserver.conf
sudo vim /etc/turnserver.conf  # 修改 external-ip 和 static-auth-secret

# 启用服务
sudo sed -i 's/TURNSERVER_ENABLED=1/TURNSERVER_ENABLED=1/' /etc/default/coturn
sudo systemctl enable coturn
sudo systemctl start coturn

# 查看状态
sudo systemctl status coturn
sudo journalctl -u coturn -f
```

### CentOS / Rocky Linux

```bash
sudo dnf install -y coturn
sudo cp turnserver.conf /etc/coturn/turnserver.conf
sudo systemctl enable coturn
sudo systemctl start coturn
```

## 防火墙配置

### iptables

```bash
# STUN/TURN 主要端口
iptables -A INPUT -p udp --dport 3478 -j ACCEPT
iptables -A INPUT -p tcp --dport 3478 -j ACCEPT

# TLS 端口
iptables -A INPUT -p tcp --dport 5349 -j ACCEPT

# TURN 中继端口范围
iptables -A INPUT -p udp --dport 49152:65535 -j ACCEPT
```

### 云服务商安全组

| 端口 | 协议 | 用途 |
|------|------|------|
| 3478 | UDP + TCP | STUN 绑定 + TURN 信令 |
| 5349 | TCP | TURN over TLS（WebRTC 安全连接）|
| 49152-65535 | UDP | TURN 中继数据通道 |

## SSL / TLS 配置（推荐用于生产环境）

### 使用 Let's Encrypt

```bash
# 安装 certbot
sudo apt install -y certbot

# 获取证书（需要域名解析到服务器）
sudo certbot certonly --standalone -d turn.quickdrop.app

# 取消 turnserver.conf 中以下两行的注释：
# cert=/etc/letsencrypt/live/turn.quickdrop.app/fullchain.pem
# pkey=/etc/letsencrypt/live/turn.quickdrop.app/privkey.pem

# 自动续期
sudo crontab -e
# 添加：0 3 * * * certbot renew --quiet && systemctl restart coturn
```

## 与 QuickDrop 集成

### 1. 客户端配置

在桌面客户端设置环境变量（或 `.env` 文件）：

```bash
# 自定义 STUN 服务器
VITE_QD_STUN_SERVERS=stun:stun.quickdrop.app:3478

# 自定义 TURN 服务器（格式：url|username|credential）
VITE_QD_TURN_SERVERS=turn:turn.quickdrop.app:3478?transport=udp|quickdrop|temp-password,turn:turn.quickdrop.app:3478?transport=tcp|quickdrop|temp-password
```

### 2. 信令服务集成（生产环境推荐）

在生产环境中，TURN 凭证应由信令服务动态生成短时效凭证：

```typescript
// 信令服务：生成 TURN 临时凭证
function generateTurnCredentials(userId: string): TurnCredential {
  const timestamp = Math.floor(Date.now() / 1000) + 3600; // 1 小时有效期
  const username = `${timestamp}:${userId}`;
  const password = hmacSHA1(staticAuthSecret, username);
  
  return {
    urls: [
      "turn:turn.quickdrop.app:3478?transport=udp",
      "turn:turn.quickdrop.app:3478?transport=tcp",
    ],
    username,
    credential: password, // HMAC-SHA1 的 base64 编码
    ttl: 3600,
  };
}
```

### 3. 验证 TURN 是否工作

在浏览器控制台：

```javascript
// 检查 ICE 候选是否包含 relay 类型
// relay 候选 = TURN 中继工作中
const pc = new RTCPeerConnection({
  iceServers: [{
    urls: "turn:turn.quickdrop.app:3478?transport=udp",
    username: "your-username",
    credential: "your-password"
  }]
});
pc.createDataChannel("test");
pc.onicecandidate = (e) => {
  if (e.candidate?.candidate.includes(" relay ")) {
    console.log("✅ TURN relay working:", e.candidate.candidate);
  }
};
pc.createOffer().then(o => pc.setLocalDescription(o));
```

## 性能基准

| 场景 | 预期表现 |
|------|---------|
| STUN 延迟 (P50) | < 50ms |
| TURN 中继延迟 (P50) | +5-20ms vs 直连 |
| 最大并发 TURN 会话 (1核/2GB) | ~200 |
| 最大并发 TURN 会话 (4核/8GB) | ~1000 |
| TURN 中继吞吐量 (单会话) | 受限于服务器带宽 |

## 监控

### 检查当前会话数

```bash
# 查看 coturn 统计信息
turnutils_uclient -v -W static-auth-secret=your-secret -u quickdrop:password -p 3478 127.0.0.1
```

### 日志分析

```bash
# 统计各设备连接数
docker compose logs coturn | grep "session.*allocated" | wc -l

# 统计 TURN 使用率（relay 候选 vs host/srflx）
docker compose logs coturn | grep "relay" | wc -l
```

## 故障排查

| 问题 | 可能原因 | 解决方案 |
|------|---------|---------|
| STUN 绑定失败 | 防火墙阻挡 UDP 3478 | 检查防火墙规则和安全组 |
| TURN 分配失败 (401) | 认证密钥不匹配 | 验证 static-auth-secret 一致性 |
| TURN 分配失败 (403) | 超过配额 | 增加 user-quota 和 total-quota |
| 中继数据不通 | UDP 端口范围未开放 | 确保 49152-65535/UDP 已开放 |
| WebRTC 连接总是 relay | 两端 NAT 类型均为对称型 | 正常行为，TURN 是唯一方案 |
| Docker 内 coturn 无法获取公网 IP | Docker NAT 转换 | 使用 `network_mode: host` |
