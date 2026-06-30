# CI/CD 文档

QuickDrop 使用 GitHub Actions 自动构建多平台安装包。

## 工作流文件

| 文件 | 用途 | 触发 |
|------|------|------|
| `.github/workflows/build-desktop.yml` | 桌面端（macOS/Windows/Linux）| tag, PR, 手动 |
| `.github/workflows/build-mobile.yml` | 移动端（Android/iOS）| tag, PR, 手动 |
| `.github/workflows/release-all.yml` | 全平台发布 + 官网部署 | tag, 手动 |

## 平台支持

| 平台 | 格式 | Runner | 大小预估 |
|------|------|--------|----------|
| **macOS** (Universal) | `.dmg` | `macos-latest` | ~5-10 MB |
| **macOS** (Apple Silicon) | `.dmg` | `macos-latest` | ~3 MB |
| **Windows** | `.msi` + `.exe` | `windows-latest` | ~5-8 MB |
| **Linux** | `.deb` + `.AppImage` | `ubuntu-22.04` | ~6-10 MB |
| **Android** | `.apk` | `ubuntu-22.04` | ~10-15 MB |
| **iOS** (Simulator) | `.app.zip` | `macos-latest` | ~8 MB |

## 使用方法

### 1. 手动触发（推荐新手）

1. 进入 GitHub 仓库页面
2. 点击 **Actions** 标签
3. 选择 **Build Desktop Apps** 或 **Build Mobile Apps**
4. 点击 **Run workflow** 按钮
5. 等待 5-15 分钟完成

### 2. 通过 tag 触发（生产发布）

```bash
# 创建新版本
git tag v1.0.0
git push origin v1.0.0

# 这会触发：
# 1. build-desktop.yml    → 构建桌面端
# 2. build-mobile.yml     → 构建移动端
# 3. release-all.yml      → 整合发布到 GitHub Releases + 部署官网
```

### 3. PR 验证（开发阶段）

每次 Push PR 时自动构建，但不发布到 Release，仅作为编译验证。

## GitHub Secrets 配置（iOS 发布需要）

如需发布到 App Store 或 TestFlight，在 GitHub 仓库配置以下 Secrets：

| Secret 名称 | 说明 |
|------------|------|
| `APPLE_TEAM_ID` | Apple Developer Team ID |
| `APPLE_CERTIFICATE_P12` | p12 证书（base64 编码）|
| `APPLE_CERTIFICATE_PASSWORD` | p12 证书密码 |
| `APPLE_PROVISIONING_PROFILE` | provisioning profile (base64) |
| `KEYCHAIN_PASSWORD` | 临时 keychain 密码 |

配置路径：`GitHub Repo → Settings → Secrets and variables → Actions → New repository secret`

## 网站下载链接配置

官网 (`website/script.js`) 中配置了下载链接：

```javascript
const GITHUB_REPO = 'your-org/your-repo';  // 修改为你的仓库
```

### 三种部署模式

**模式 1：静态托管（当前）**
- 文件放在 `website/downloads/`
- 通过 HTTP 服务器直接提供
- 适合 demo 和小规模用户

**模式 2：GitHub Releases（推荐生产）**
- 工作流自动上传到 Releases
- 用户从 `https://github.com/xxx/releases/latest` 下载
- 自动获得 CDN 加速、版本管理

**模式 3：CDN / S3（大规模）**
- 上传到 S3 / R2 / 七牛 / 阿里云 OSS
- 全球 CDN 加速
- 需要额外配置

修改 `GITHUB_REPO` 后，下载链接会自动指向 GitHub Releases。

## 常见问题

### Q: macOS 构建很慢？
A: 第一次需要 5-10 分钟（编译 Rust 依赖），后续会快很多（2-3 分钟）。已配置 `rust-cache` 加速。

### Q: Windows Runner 能否在 macOS 上工作？
A: 可以在 macOS 上交叉编译，但推荐使用 GitHub 提供的 `windows-latest` runner。

### Q: 如何发布预发布版本（beta/rc）？
A: tag 名称包含 `beta`/`rc`/`alpha` 时会自动标记为 prerelease：
```bash
git tag v1.0.0-beta.1
```

### Q: 如何只在特定平台发布？
A: 编辑对应的 `.yml` 文件，删除不需要的 job。

## 监控

- **构建状态**: GitHub Actions tab
- **Artifacts**: 每个 build 会保留 30 天
- **Releases**: 自动创建 GitHub Release
- **部署**: 官网自动部署到 GitHub Pages

## 升级

修改 `.github/workflows/` 中的文件后，下次触发会自动使用新配置。

---

详细配置参考：[GitHub Actions 文档](https://docs.github.com/en/actions)
