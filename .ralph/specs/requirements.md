# QuickDrop 技术规格说明书

> 来源: PRD.md v1.0 · 生成日期: 2026-06-21 · 状态: 设计阶段

---

## 目录

- [1. 系统架构](#1-系统架构)
- [2. 数据模型](#2-数据模型)
- [3. API 规格](#3-api-规格)
- [4. WebSocket 协议](#4-websocket-协议)
- [5. WebRTC 传输规格](#5-webrtc-传输规格)
- [6. 用户界面规格](#6-用户界面规格)
- [7. 性能要求](#7-性能要求)
- [8. 安全规格](#8-安全规格)
- [9. 验收标准](#9-验收标准)
- [10. 事件追踪](#10-事件追踪)

---

## 1. 系统架构

### 1.1 分层架构

```
客户端层 (Windows / macOS / Android / iOS)
      │
      ├── WebSocket ──── 信令服务 (配对、设备发现、信令转发)
      │
      ├── HTTPS ──────── 认证服务 (注册、登录、Token 管理)
      │
      └── WebRTC P2P ── 文件数据直连（不经过任何服务器）

中继层: STUN/TURN 服务器（仅在无法直连时启用）
```

### 1.2 核心模块职责

| 模块 | 职责 | 技术栈 |
|---|---|---|
| **认证服务** | 用户注册/登录、Token 签发/刷新/撤销、设备会话管理、速率限制 | RESTful API, PostgreSQL, Redis, bcrypt, JWT |
| **信令服务** | WebSocket 连接管理、设备上线/下线广播、同账户自动配对、配对码/扫码管理、WebRTC 信令透传 | WebSocket, JWT 认证 |
| **P2P 传输模块** | ICE 候选收集、DataChannel 建立、文件分块传输(16KB)、CRC32 校验、SHA256 完整性验证 | WebRTC, SCTP |
| **桌面客户端** | 登录/注册 UI、设备列表、文件拖拽/选择传输、传输进度、连接通道指示 | Tauri (Rust + Web 前端) |
| **移动客户端** | 登录、扫码、设备列表、文件选择传输 | Android (Kotlin) / iOS (Swift) + WebView |

### 1.3 连接优先级策略

通道选择由 ICE 框架自动完成，用户无需干预：

| 优先级 | 通道 | 适用场景 | 预期速率 |
|---|---|---|---|
| 1 (最高) | 蓝牙/热点直连 | 短距离，无 WiFi | 3~10 MB/s |
| 2 | 局域网 P2P (WiFi) | 同一局域网 | 50~100+ MB/s |
| 3 (备用) | TURN 中继 | NAT 穿透失败 | 取决于中继带宽 |

---

## 2. 数据模型

### 2.1 用户表 (users)

| 字段 | 类型 | 约束 | 说明 |
|---|---|---|---|
| id | UUID | PK, 默认生成 | 用户唯一标识 |
| email | VARCHAR(255) | UNIQUE, NOT NULL | 登录邮箱 |
| password_hash | VARCHAR(255) | NOT NULL | bcrypt(cost=12) 哈希 |
| created_at | TIMESTAMP | NOT NULL, DEFAULT NOW() | 注册时间 |
| updated_at | TIMESTAMP | NOT NULL | 最后更新时间 |
| is_locked | BOOLEAN | DEFAULT FALSE | 账户是否锁定 |
| locked_until | TIMESTAMP | NULLABLE | 锁定到期时间 |
| failed_login_attempts | INTEGER | DEFAULT 0 | 连续登录失败次数 |

### 2.2 设备表 (devices)

| 字段 | 类型 | 约束 | 说明 |
|---|---|---|---|
| id | UUID | PK, 默认生成 | 设备唯一标识 |
| user_id | UUID | FK → users.id, NOT NULL | 所属用户 |
| device_name | VARCHAR(128) | NOT NULL | 设备名称（客户端上报） |
| device_type | VARCHAR(32) | NOT NULL | 设备类型: desktop/phone/tablet |
| os | VARCHAR(32) | NOT NULL | 操作系统: windows/macos/android/ios |
| first_seen | TIMESTAMP | NOT NULL | 首次登录时间 |
| last_seen | TIMESTAMP | NOT NULL | 最后活跃时间 |
| is_online | BOOLEAN | DEFAULT FALSE | 当前在线状态 |
| is_active | BOOLEAN | DEFAULT TRUE | 是否活跃（超过 N 天未登录标记为不活跃） |

### 2.3 Refresh Token 表 (refresh_tokens)

| 字段 | 类型 | 约束 | 说明 |
|---|---|---|---|
| id | UUID | PK | Token 唯一标识 |
| user_id | UUID | FK → users.id | 所属用户 |
| device_id | UUID | FK → devices.id | 关联设备 |
| token_hash | VARCHAR(255) | UNIQUE, NOT NULL | Token 的 SHA256 哈希 |
| expires_at | TIMESTAMP | NOT NULL | 过期时间 |
| created_at | TIMESTAMP | NOT NULL | 签发时间 |
| revoked | BOOLEAN | DEFAULT FALSE | 是否已撤销 |

### 2.4 Token 黑名单表 (token_blacklist)

| 字段 | 类型 | 约束 | 说明 |
|---|---|---|---|
| id | UUID | PK | 记录 ID |
| token_jti | VARCHAR(255) | UNIQUE, NOT NULL | JWT 的 JTI |
| expires_at | TIMESTAMP | NOT NULL | 黑名单过期时间（= JWT 原过期时间） |
| created_at | TIMESTAMP | NOT NULL | 加入黑名单时间 |

### 2.5 配对码表 (pairing_codes)

| 字段 | 类型 | 约束 | 说明 |
|---|---|---|---|
| id | UUID | PK | 配对记录 ID |
| code | VARCHAR(6) | UNIQUE, NOT NULL | 6 位数字配对码 |
| room_id | VARCHAR(64) | NOT NULL | 临时房间 ID |
| creator_device_id | UUID | FK → devices.id | 创建配对码的设备 |
| expires_at | TIMESTAMP | NOT NULL | 过期时间（创建后 2 分钟） |
| used | BOOLEAN | DEFAULT FALSE | 是否已被使用 |
| created_at | TIMESTAMP | NOT NULL | 创建时间 |

---

## 3. API 规格

### 3.1 认证 API

所有认证 API 的基础路径: `/api/v1/auth`

#### POST /api/v1/auth/register

注册新用户并自动登录当前设备。

**请求体:**
```json
{
  "email": "user@example.com",
  "password": "Abc123456",
  "device_name": "MacBook Pro",
  "device_type": "desktop",
  "os": "macos"
}
```

**校验规则:**
- email: 必填，最多 255 字符，符合邮箱格式正则，唯一性校验
- password: 必填，最少 8 位，必须包含大写字母、小写字母、数字，最多 128 字符
- device_name: 必填，客户端自动检测上报

**成功响应 (201):**
```json
{
  "user_id": "uuid",
  "email": "user@example.com",
  "device_id": "uuid",
  "access_token": "jwt...",
  "refresh_token": "jwt...",
  "expires_in": 3600
}
```

**错误响应:**
- 400: 参数校验失败（邮箱格式错误 / 密码不符合规则）
- 409: 邮箱已被注册

#### POST /api/v1/auth/login

用户登录。

**请求体:**
```json
{
  "email": "user@example.com",
  "password": "Abc123456",
  "device_name": "iPhone 16 Pro",
  "device_type": "phone",
  "os": "ios",
  "remember_device": true
}
```

**成功响应 (200):** 同注册成功响应

**错误响应:**
- 400: 参数校验失败
- 401: 邮箱或密码错误
- 423: 账户已临时锁定（连续 5 次失败后锁定 15 分钟）

**速率限制:** 单 IP 每分钟最多 10 次请求，超限返回 429

#### POST /api/v1/auth/refresh

刷新 Access Token。

**请求体:**
```json
{
  "refresh_token": "jwt..."
}
```

**成功响应 (200):**
```json
{
  "access_token": "new_jwt...",
  "refresh_token": "new_jwt...",
  "expires_in": 3600
}
```

**Refresh Token 轮换策略:** 每次刷新同时签发新的 Refresh Token，旧的立即撤销

#### POST /api/v1/auth/logout

退出登录。

**请求体:**
```json
{
  "scope": "single"  // "single" | "all"
}
```

**Header:** `Authorization: Bearer <access_token>`

**行为:**
- `single`: 仅当前设备退出，当前 Token 加入黑名单
- `all`: 该账户所有已签发 Token 加入黑名单，通过信令服务向所有在线设备推送 `force_logout`

**成功响应 (200):**
```json
{
  "message": "Logged out successfully",
  "affected_devices": 1
}
```

### 3.2 设备管理 API

基础路径: `/api/v1/devices`

#### GET /api/v1/devices

获取当前用户的所有已登录设备列表。

**Header:** `Authorization: Bearer <access_token>`

**成功响应 (200):**
```json
{
  "devices": [
    {
      "device_id": "uuid",
      "device_name": "MacBook Pro",
      "device_type": "desktop",
      "os": "macos",
      "is_online": true,
      "first_seen": "2026-06-21T10:00:00Z",
      "last_seen": "2026-06-21T14:30:00Z"
    }
  ]
}
```

#### DELETE /api/v1/devices/{device_id}

远程移除指定设备。

**Header:** `Authorization: Bearer <access_token>`

**行为:** 将该设备的所有 Token 加入黑名单，通过信令服务向该设备推送 `force_logout`

**成功响应 (200):**
```json
{
  "message": "Device removed successfully"
}
```

### 3.3 配对 API

基础路径: `/api/v1/pairing`

#### POST /api/v1/pairing/qrcode

生成扫码配对的二维码信息。

**Header:** `Authorization: Bearer <access_token>` (可选)

**成功响应 (200):**
```json
{
  "room_id": "uuid",
  "pairing_token": "one-time-token",
  "ws_url": "wss://signal.quickdrop.app/ws",
  "expires_at": "2026-06-21T14:32:00Z",
  "qr_data": "{...}"  // 二维码编码数据
}
```

#### POST /api/v1/pairing/code

生成 6 位配对码。

**Header:** `Authorization: Bearer <access_token>` (可选)

**成功响应 (200):**
```json
{
  "code": "482915",
  "room_id": "uuid",
  "expires_at": "2026-06-21T14:32:00Z"
}
```

#### POST /api/v1/pairing/join

通过配对码加入房间。

**请求体:**
```json
{
  "code": "482915",
  "device_name": "Windows PC",
  "device_type": "desktop"
}
```

**成功响应 (200):**
```json
{
  "room_id": "uuid",
  "message": "Joined room successfully"
}
```

**错误响应:**
- 404: 配对码无效或已过期
- 429: 配对尝试过于频繁（同 IP 每 60 秒最多 5 次）

---

## 4. WebSocket 协议

### 4.1 连接建立

```
客户端 → wss://signal.quickdrop.app/ws?token=<access_token>
```

服务端验证 JWT Token，解析 userId 和 deviceId，注册设备在线状态。

### 4.2 消息格式

所有消息使用 JSON 格式:

```json
{
  "type": "message_type",
  "payload": { ... },
  "timestamp": "2026-06-21T14:30:00Z"
}
```

### 4.3 服务端 → 客户端消息

| type | payload | 说明 |
|---|---|---|
| `same_account_device_online` | `{ device_id, device_name, device_type, os }` | 同账户设备上线通知 |
| `same_account_device_offline` | `{ device_id }` | 同账户设备下线通知 |
| `webrtc_offer` | `{ from_device_id, sdp }` | 转发 WebRTC Offer |
| `webrtc_answer` | `{ from_device_id, sdp }` | 转发 WebRTC Answer |
| `ice_candidate` | `{ from_device_id, candidate }` | 转发 ICE Candidate |
| `pairing_success` | `{ room_id, peer_device_id, peer_device_name }` | 配对成功通知 |
| `force_logout` | `{ reason }` | 强制下线通知 |
| `error` | `{ code, message }` | 错误消息 |

### 4.4 客户端 → 服务端消息

| type | payload | 说明 |
|---|---|---|
| `ping` | `{}` | 心跳（每 15 秒发送） |
| `webrtc_offer` | `{ target_device_id, sdp }` | 发送 WebRTC Offer |
| `webrtc_answer` | `{ target_device_id, sdp }` | 发送 WebRTC Answer |
| `ice_candidate` | `{ target_device_id, candidate }` | 发送 ICE Candidate |
| `join_room` | `{ room_id }` | 加入配对房间 |
| `request_connection` | `{ target_device_id }` | 请求与指定设备建立 P2P 连接 |

### 4.5 心跳与离线检测

- 客户端每 15 秒发送 `ping` 消息
- 服务端 30 秒未收到 ping 视为设备离线
- 离线时广播 `same_account_device_offline` 给同账户其他在线设备

---

## 5. WebRTC 传输规格

### 5.1 DataChannel 配置

```
- 模式: ordered: true (有序可靠模式)
- 传输层: SCTP (Stream Control Transmission Protocol)
- 加密: DTLS (Datagram Transport Layer Security)
- 分块大小: 16KB (16384 bytes)
```

### 5.2 文件传输协议

#### 元数据消息 (发送端 → 接收端，首个消息)

```json
{
  "type": "file_meta",
  "file_id": "uuid",
  "file_name": "design-review.mp4",
  "file_size": 524288000,
  "file_type": "video/mp4",
  "mime_type": "video/mp4",
  "total_chunks": 32000,
  "chunk_size": 16384,
  "sha256": "abc123..."
}
```

#### 分块消息 (二进制)

```
[4 bytes: CRC32 of chunk data]
[4 bytes: chunk_index (uint32, big-endian)]
[N bytes: chunk_data (up to 16384 bytes)]
```

#### 完成确认 (接收端 → 发送端)

```json
{
  "type": "transfer_complete",
  "file_id": "uuid",
  "received_bytes": 524288000,
  "sha256": "abc123...",
  "checksum_match": true
}
```

### 5.3 完整性校验流程

1. 发送端计算整个文件的 SHA256 哈希，在 `file_meta` 中发送
2. 发送端将文件按 16KB 分块，每块计算 CRC32 校验值
3. 接收端逐块验证 CRC32，发现损坏请求重传该块
4. 接收端重组完整文件后计算 SHA256
5. SHA256 与发送端提供的值比对
6. 不一致 → 自动重新传输整个文件（最多重试 3 次）
7. 3 次重试仍失败 → 提示用户传输异常

### 5.4 并行传输

- 最多同时 5 个文件并行传输
- 超出限制的文件进入 FIFO 等待队列
- 每个文件使用独立的 DataChannel（或复用同一通道并流控）

### 5.5 ICE 配置

```
- STUN 服务器: stun:stun.quickdrop.app:3478
- TURN 服务器: turn:turn.quickdrop.app:3478 (UDP + TCP)
- ICE 候选收集策略: 全部 (host + srflx + relay)
- ICE 连接超时: 30 秒
```

---

## 6. 用户界面规格

### 6.1 桌面端主界面布局

```
┌────────────────────────────────────────────────────────┐
│  QuickDrop                                    ✅ 已连接  │
├───────────────────┬────────────────────────────────────┤
│  设备              │  发送至: iPhone 16 Pro              │
│                   │                                    │
│  [设备列表]         │  连接方式: 📶 蓝牙 | 🌐 局域网 | ☁️ 中继 │
│                   │                                    │
│                   │  ┌────────────────────────────────┐ │
│                   │  │       📁 拖拽文件到此处          │ │
│                   │  │   或点击选择文件                 │ │
│                   │  │  视频、音频保持原画质 · 无损传输 │ │
│                   │  └────────────────────────────────┘ │
│                   │                                    │
│                   │  📤 传输记录 (最近 50 条)            │
└───────────────────┴────────────────────────────────────┘
```

### 6.2 登录/注册页面

```
┌──────────────────────────────────────┐
│         QuickDrop                     │
│                                       │
│   ┌──────────────────────────────┐    │
│   │        欢迎使用 QuickDrop      │    │
│   │   ┌────────────────────────┐   │    │
│   │   │ 邮箱                    │   │    │
│   │   └────────────────────────┘   │    │
│   │   ┌────────────────────────┐   │    │
│   │   │ 密码                    │   │    │
│   │   └────────────────────────┘   │    │
│   │   ┌────────────────────────┐   │    │
│   │   │       登录              │   │    │
│   │   └────────────────────────┘   │    │
│   │   没有账户？[注册]             │    │
│   └──────────────────────────────┘    │
└──────────────────────────────────────┘
```

### 6.3 设备列表规范

设备列表分为两个分区：

**"我的账户"分区:**
- 展示同账户下所有已登录设备
- 自动配对，无需手动操作
- 每台设备显示: 类型图标 (💻/📱/🖥️)、设备名称、在线状态、连接方式标签、最后在线时间
- 按在线状态排序（在线在前），在线设备按活跃时间排序
- 最多显示 20 台设备

**"已配对设备"分区:**
- 展示通过扫码/配对码方式临时配对的设备
- 不受账户限制

### 6.4 连接通道指示标签

| 标签 | 优先级 | 显示条件 |
|---|---|---|
| 📶 蓝牙/热点 | 最高 | ICE 候选为 bluetooth 或 host（热点网络接口） |
| 🌐 局域网 (WiFi) | 中 | ICE 候选为 host（局域网 IP 段） |
| ☁️ 中继 | 备用 | ICE 候选为 relay |

当前生效通道高亮，其余置灰。悬停可查看延迟信息。

### 6.5 传输进度组件

每个传输条目显示:
- 文件图标 (按类型)
- 文件名
- 文件大小
- 目标设备名
- 进度条 (渐变色动画，完成变绿，失败变红)
- 实时速度 (MB/s)
- 剩余时间估计
- 无损标记角标

### 6.6 配对码输入 (移动端)

- 6 个独立数字格子，每个一个数字位
- 逐个输入数字，自动跳转到下一位
- 支持粘贴完整 6 位数字
- 6 位输完后自动或点击按钮发起连接

### 6.7 交互反馈

- 拖拽文件进入窗口: 拖拽区边框高亮，显示"松开以发送到 [设备名]"
- 未选择目标设备时拖拽: 提示"请先选择一个目标设备"
- 传输完成: 进度条变绿，显示"完成"标记，粒子爆发动效
- 传输失败: 进度条变红，显示"失败"和错误原因
- 登录/注册中: 按钮变为加载状态
- 新设备上线: 弹出通知提示

---

## 7. 性能要求

### 7.1 传输性能

| 指标 | 目标值 | 测量方法 |
|---|---|---|
| 局域网传输速度 (WiFi 5, 5GHz) | > 50 MB/s | 传输 500MB 文件统计平均速度 |
| 局域网传输速度 (WiFi 6) | > 80 MB/s | 传输 500MB 文件统计平均速度 |
| 连接成功率 (局域网) | > 99% | 客户端上报连接事件 |
| 连接成功率 (公网) | > 95% | 客户端上报连接事件 |
| 传输成功率 | > 99.9% | 客户端上报传输完成/失败事件 |
| 自动配对延迟 P50 | < 5 秒 | 客户端时间戳记录 |
| 自动配对延迟 P95 | < 10 秒 | 客户端时间戳记录 |
| 无损达标率 | 100% | 每次传输 SHA256 校验 |

### 7.2 资源占用

| 指标 | 目标值 |
|---|---|
| 客户端空闲内存 | < 100 MB |
| 传输 10GB 文件峰值内存 | < 300 MB |
| 信令服务 WebSocket 并发 | 1000 连接，CPU < 50% |

### 7.3 文件大小

- 无文件大小上限（受设备存储和网络带宽限制）
- 已验证: 支持 10GB+ 文件传输

---

## 8. 安全规格

### 8.1 密码安全

- 存储: bcrypt 哈希，cost=12
- 传输: 仅通过 HTTPS
- 强度: 最少 8 位，必须包含大写字母、小写字母、数字
- 锁定: 连续 5 次登录失败后锁定 15 分钟

### 8.2 Token 安全

- Access Token: JWT 格式，短有效期 (建议 1 小时)
- Refresh Token: 长有效期 (建议 30 天)，每次刷新时轮换
- 传输: 仅通过 HTTPS
- 撤销: 退出登录后 1 秒内加入黑名单生效
- 黑名单: 存储 JWT JTI，自动清理过期记录

### 8.3 传输安全

- 信令通道: WebSocket over TLS (WSS)
- 文件数据: WebRTC DataChannel DTLS 加密
- 抓包工具无法还原文件内容
- 文件数据不经过任何服务器

### 8.4 速率限制

| 接口 | 限制 |
|---|---|
| POST /api/v1/auth/login | 单 IP 每分钟 10 次 |
| POST /api/v1/auth/register | 单 IP 每小时 5 次 |
| POST /api/v1/pairing/join | 同 IP 每 60 秒 5 次 |

### 8.5 配对码安全

- 有效期 2 分钟
- 排除易混淆组合 (123456, 000000, 111111 等)
- 同 IP 每 60 秒最多 5 次配对尝试
- 一次性使用，配对成功后立即失效

---

## 9. 验收标准

### 9.1 功能验收

| 编号 | 验收项 | 通过条件 |
|---|---|---|
| A1 | 用户注册 | 有效邮箱+合规密码 → 创建账户并自动登录 |
| A2 | 用户登录 | 正确凭证 → 登录成功跳转主界面 |
| A3 | 登录失败处理 | 错误密码提示明确；连续 5 次失败后锁定提示 |
| A4 | 自动配对 | 同账户设备登录后 10 秒内互相出现在设备列表 |
| A5 | 扫码配对 | 桌面端生成二维码，移动端扫码后 15 秒内完成配对 |
| A6 | 配对码配对 | 6 位码输入后 15 秒内完成配对 |
| A7 | 文件拖拽传输 | 拖拽文件到窗口后文件开始传输到目标设备 |
| A8 | 无损传输 | 1GB 视频传输后 SHA256 完全一致 |
| A9 | 大文件传输 | 10GB 文件传输不崩溃，速率正常 |
| A10 | 并行传输 | 3 个文件同时传输全部成功且校验通过 |
| A11 | 断线恢复 | 断网重连后自动恢复在线（Phase 2） |
| A12 | 退出登录 | 退出后设备从列表移除，其他设备收到下线通知 |

### 9.2 性能验收

| 编号 | 验收项 | 通过条件 |
|---|---|---|
| P1 | 局域网传输速度 | WiFi 5 下 500MB 文件平均速度 > 50MB/s |
| P2 | 自动配对延迟 | P50 < 5 秒，P95 < 10 秒 |
| P3 | 客户端内存 | 空闲 < 100MB；传输 10GB 时峰值 < 300MB |
| P4 | 服务端并发 | 1000 WebSocket 连接 CPU < 50% |

### 9.3 安全验收

| 编号 | 验收项 | 通过条件 |
|---|---|---|
| S1 | 密码存储 | bcrypt(cost=12) 哈希存储 |
| S2 | Token 传输 | 仅通过 HTTPS |
| S3 | Token 撤销 | 退出后 1 秒内失效 |
| S4 | 文件数据安全 | DTLS 加密，抓包无法还原 |
| S5 | 速率限制 | 登录接口超限返回 429 |

---

## 10. 事件追踪

### 10.1 需要追踪的事件

| 事件名 | 触发时机 | 附带属性 |
|---|---|---|
| `user_registered` | 注册成功 | userId, deviceType, deviceName |
| `user_logged_in` | 登录成功 | userId, deviceType, deviceName |
| `user_logged_out` | 退出登录 | userId, scope(single/all) |
| `device_auto_paired` | 自动配对完成 | userId, pairedDeviceId, transportType, latencyMs |
| `device_manual_paired` | 扫码/配对码配对完成 | pairType(scan/code), transportType |
| `file_transfer_started` | 传输开始 | fileId, fileSize, fileType, targetDeviceId |
| `file_transfer_completed` | 传输成功 | fileId, totalBytes, durationMs, avgSpeed, checksumMatch |
| `file_transfer_failed` | 传输失败 | fileId, errorCode, retryCount |
| `connection_channel_switched` | 通道变更 | fromType, toType, reason |

### 10.2 核心指标

| 指标 | 定义 | 目标值 |
|---|---|---|
| 连接成功率 | DataChannel 建立成功比例 | > 99% (局域网) / > 95% (公网) |
| 传输成功率 | 完整送达且校验通过比例 | > 99.9% |
| 自动配对延迟 | 登录 → 出现在对方列表 | < 5s (P50) / < 10s (P95) |
| 无损达标率 | 校验一致比例 | 100% |
| 局域网吞吐量 | 同一 WiFi 下实际速度 | > 50 MB/s (WiFi 5) |
| 用户留存率 | 次日/7日/30日 | 待上线后确定 |

---

> **关联文档**: 认证详细设计见 [AUTH_DESIGN.md](../../AUTH_DESIGN.md)，技术总览见 [README.md](../../README.md)
