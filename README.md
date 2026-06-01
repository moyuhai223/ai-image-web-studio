# AI Image Web Studio

AI Image Web Studio 是一个适合 3-5 人小团队部署的私有 AI 图片生成工作台。应用通过服务端调用兼容图片接口的 Provider Base URL，前端不暴露 API Key；生成记录写入 PostgreSQL，生成图、参考图、缩略图和备份包保存在服务器本地磁盘。

更新记录见 [CHANGELOG.md](./CHANGELOG.md)。

## 主要功能

- 账号密码登录，支持 `admin` 和 `member` 角色。
- 支持 `gpt-image-2` 和 `Nano Banana 2`。
- 支持文生图、参考图修图、已生成图片再次作为参考图，参考图篮可跨分页收集最多 4 张图。
- 后台任务队列，支持取消、重新排队、失败后重试。
- 多 Key 轮询，支持 Key 健康统计和自定义失败自动停用策略。
- 生成记录、任务详情、最近记录、记录页筛选、分页和批量操作。
- 图片级标签，支持历史标签选择和按标签搜索。
- 大图预览支持鼠标滚轮、触控缩放、键盘翻页、跨页翻图和下载。
- 缩略图优先加载，点击后再加载原图，减少首页和记录页流量。
- 提示词模板管理。
- 系统健康检查，显示数据库、存储目录、Key 数量、版本和最近错误。
- 存储维护：孤儿文件扫描、重新生成缩略图、清理失败任务图片。
- 数据备份和恢复：可创建、校验、下载、删除、上传、恢复 `.tar.gz` 备份包，并支持自动备份策略。
- 管理操作审计日志，便于回看备份、Key、用户、模板、参考图和记录操作。
- 多主题界面，支持自动日夜间主题和移动端图标导航。
- 更新日志页面：`/changelog`。

## 技术栈

- Next.js App Router
- React
- PostgreSQL
- Node.js 22
- Sharp 缩略图处理
- Docker / Docker Compose
- 1Panel 本地应用包

## 1Panel 本地应用包

本地应用包只保留最新版本目录，历史版本不再随 zip 一起上传，避免包体随着迭代持续变大。

本地应用包参照 `1panel-app-adapter` 的结构刷新：

- 应用根目录包含 `data.yml`、`README.md`、`logo.png` 和 `source-evidence.json`。
- 版本目录包含 `data.yml`、`docker-compose.yml`、`.env.sample` 和 `scripts/*.sh`。
- 版本目录仍保留 `source/` 源码，继续支持本地 Dockerfile 构建。
- Compose 继续接入外部 `1panel-network`，方便连接已有 1Panel PostgreSQL 容器。

## 数据保存位置

默认本地开发：

```text
storage/
  images/       生成图片
  references/   参考图
  thumbnails/   缩略图
  backups/      数据备份包
```

1Panel 本地应用默认挂载：

```text
1panel-local-app/ai-image-web-studio/<version>/data/storage
```

Docker 容器内路径统一为：

```text
/app/storage
```

## 本地开发

```bash
npm install
copy .env.example .env
npm run db:init
npm run user:create -- admin your-password
npm run dev
```

打开：

```text
http://localhost:3000
```

## 环境变量

`.env.example` 提供了完整示例：

```text
DATABASE_URL=postgres://postgres:postgres@localhost:5432/ai_image_web_studio
AUTH_SECRET=replace-with-a-long-random-secret
PANEL_APP_PORT_HTTP=3100
TZ=Asia/Shanghai
APP_TIME_ZONE=Asia/Shanghai
NPM_REGISTRY=https://registry.npmmirror.com
GITHUB_REPOSITORY_SLUG=moyuhai223/ai-image-web-studio
PROVIDER_BASE_URL=
PROVIDER_API_KEY=
IMAGE_MODEL_GPT=gpt-image-2
IMAGE_MODEL_NANO_BANANA=Nano Banana 2
IMAGE_MODEL_GEMINI=gemini-3.1-flash-image
LOCAL_STORAGE_ROOT=./storage
MAX_UPLOAD_MB=20
MAX_GENERATION_CONCURRENCY=2
MAX_GENERATION_QUEUE_SIZE=20
DAILY_GENERATION_LIMIT=50
GENERATION_TIMEOUT_MS=900000
```

常用说明：

| 变量 | 说明 |
| --- | --- |
| `DATABASE_URL` | PostgreSQL 连接串 |
| `AUTH_SECRET` | 登录 Cookie 签名密钥，生产环境必须使用长随机字符串 |
| `PANEL_APP_PORT_HTTP` | Web 访问端口，默认 `3100` |
| `TZ` | 容器时区，默认 `Asia/Shanghai` |
| `APP_TIME_ZONE` | 页面显示时区，默认 `Asia/Shanghai` |
| `NPM_REGISTRY` | Docker 构建时 npm 镜像源，默认 `https://registry.npmmirror.com` |
| `GITHUB_REPOSITORY_SLUG` | 检查更新使用的 GitHub 仓库，默认 `moyuhai223/ai-image-web-studio` |
| `PROVIDER_BASE_URL` | Provider 地址默认值；部署后也可在设置页“运行设置”里修改 |
| `PROVIDER_API_KEY` | 默认备用 API Key，设置页可继续添加多 Key |
| `LOCAL_STORAGE_ROOT` | 图片、缩略图和备份包保存目录 |
| `MAX_UPLOAD_MB` | 参考图上传大小限制 |
| `MAX_GENERATION_CONCURRENCY` | 后台生成并发数 |
| `MAX_GENERATION_QUEUE_SIZE` | 队列最大排队数量 |
| `DAILY_GENERATION_LIMIT` | 单用户每日生成限制，`0` 表示不限 |
| `GENERATION_TIMEOUT_MS` | 单次模型请求硬超时时间，默认 15 分钟 |

## 图片尺寸

内置常用尺寸：

| 比例 | 尺寸 |
| --- | --- |
| `auto` | 由模型/provider 决定 |
| `1:1` | `1024x1024` |
| `9:16` | `1024x1824` |
| `16:9` | `1824x1024` |
| `4:3` | `1360x1024` |
| `3:4` | `1024x1360` |

自定义尺寸时建议宽高都能被 8 整除；`gpt-image-2` 实测对尺寸更敏感，遇到 provider 报错时优先使用内置预设或 `auto`。

## 生产部署

### Docker Compose

项目根目录提供了 `docker-compose.yml`，默认 Web 端口为 `3100`：

```bash
cp .env.1panel.example .env
docker compose up -d --build
```

容器首次启动会自动执行数据库初始化并创建初始管理员：

- 留空 `ADMIN_PASSWORD` 时，自动创建默认管理员 `admin / admin`，并在**首次登录时强制修改密码**（改密完成前无法使用任何功能）。
- 自行填写 `ADMIN_PASSWORD` 时，使用你填写的密码、不强制改密；可用 `ADMIN_USERNAME` 自定义账号名（默认 `admin`）。
- 如果同名用户已存在，不会覆盖密码（既有部署不受影响）。忘记密码可在容器内执行 `node scripts/create-admin.mjs <用户名> <新密码>` 重置。

### 1Panel 部署

推荐使用项目内生成好的本地应用包：

```text
ai-image-web-studio-1panel-local-app.zip
```

在 1Panel 中导入本地应用后填写：

- Web 访问端口，默认 `3100`
- PostgreSQL 连接串
- 登录密钥 `AUTH_SECRET`
- Provider Base URL 和 API Key
- 初始管理员账号和密码（密码留空则默认 `admin/admin`，首次登录强制改密）
- 并发、队列、每日限制、超时时间等参数

如果 1Panel 已经安装 PostgreSQL 容器，需要确保应用容器和 PostgreSQL 容器在同一个 Docker 网络。当前本地应用的 compose 已默认接入：

```yaml
networks:
  - 1panel-network
```

外部网络定义：

```yaml
networks:
  1panel-network:
    external: true
```

PostgreSQL 连接串示例：

```text
postgres://用户名:密码@1Panel-postgresql-xxxx:5432/数据库名
```

如果出现 `getaddrinfo ENOTFOUND PostgreSQL容器名`，通常是应用容器和数据库容器不在同一个 Docker 网络。

如果生成图片时报 `EACCES: permission denied, mkdir '/app/storage/images'`，是宿主 `storage` 目录归属与容器内用户（uid 1001）不一致所致。v0.7.5+ 的安装/更新脚本已自动修正；已装的旧版本执行一次即可解除（随后重试生成，无需重启）：

```bash
docker exec -u 0 ai-image-web-studio sh -c "mkdir -p /app/storage/images /app/storage/references && chown -R nextjs:nodejs /app/storage"
```

## 在线更新

项目支持 GitHub Release 更新流。

### 发布新版本

本地完成代码更新并推送后，打标签即可触发 GitHub Actions：

```bash
git tag v0.4.16
git push origin v0.4.16
```

Actions 会自动：

- 安装依赖
- 执行 `npm run build`
- 生成只包含最新版本的 1Panel 本地应用 zip
- 创建或更新 GitHub Release
- 上传 `ai-image-web-studio-1panel-local-app-v版本号.zip`

### 检查更新

管理员可在设置页“系统状态”里的“版本更新”卡片点击“检查更新”。

卡片会显示：

- 当前版本
- GitHub 最新 Release
- 是否有新版本
- Release 页面链接
- 1Panel zip 附件下载链接
- 服务器更新命令提示

源码部署的服务器可在项目目录执行：

```bash
git pull
docker compose up -d --build
```

1Panel 本地应用部署可下载最新 Release 附件里的 zip 后，在 1Panel 中手动导入更新。

### 一键更新脚本（推荐）

`scripts/update.sh` 会自动下载最新 Release 包、覆盖安装目录并重建容器（保留 `.env` 与 `storage/`，覆盖前自动备份最近 3 份可回滚）。安装一次后随时运行：

```bash
curl -fsSL https://raw.githubusercontent.com/moyuhai223/ai-image-web-studio/main/scripts/update.sh -o /usr/local/bin/aiws-update
chmod +x /usr/local/bin/aiws-update

aiws-update              # 更新到最新版本
aiws-update v0.7.4       # 更新到指定版本
FORCE=1 aiws-update      # 版本相同也强制重建
```

默认安装目录为 `/opt/1panel/apps/ai-image-web-studio`，可用 `APP_DIR=/你的路径 aiws-update` 覆盖。脚本只更新 `source/`、`docker-compose.yml`、`scripts/`，不会动 `.env`（连接串/密钥）和 `storage/`（图片数据）。

## 上传文件说明

部署时不需要上传这些目录：

```text
node_modules/
.next/
storage/
```

必须保留：

```text
app/
components/
lib/
public/
scripts/
package.json
package-lock.json
Dockerfile
docker-compose.yml
next.config.mjs
tsconfig.json
CHANGELOG.md
```

如果使用 `ai-image-web-studio-1panel-local-app.zip`，直接上传压缩包即可。

## 反向代理

应用容器内部端口是 `3000`。常见反代目标：

```text
http://127.0.0.1:3100
```

Cloudflare 或其他 CDN 下，建议缓存：

- `/_next/static/*`
- 图片缩略图接口可以短时缓存，但鉴权图片接口仍应谨慎处理

不要缓存：

- `/`
- `/login`
- `/settings`
- `/records`
- `/api/*`

这些页面和接口依赖登录态、任务状态或数据库实时数据。

## 备份和恢复

设置页提供“数据备份”功能。

备份包保存到：

```text
storage/backups/
```

备份包内容：

```text
manifest.json
database/schema.sql
database/*.json
storage/images/
storage/references/
storage/thumbnails/
```

恢复方式：

- 恢复前可先点击“校验”或“上传校验”检查备份包结构
- 从服务器已有备份包点击“恢复”
- 上传外部 `.tar.gz` 备份包并恢复

恢复保护：

- 有排队或运行中的任务时会拒绝恢复
- 恢复前会自动创建当前数据安全备份
- 先解包到临时目录并校验 `manifest.json`
- 再恢复数据库和图片目录

恢复会覆盖当前数据库和本地图片目录，执行前建议确认已经下载一份安全备份。

自动备份：

- 设置页可启用自动备份
- 可配置备份间隔小时数和本地保留份数
- Docker healthcheck 会触发轻量检查，到达间隔后自动创建备份
- 自动备份仍保存到 `storage/backups/`

## 日常维护

推荐定期检查：

- 设置页“系统状态”
- 设置页“Key 管理”
- 设置页“存储维护”
- 设置页“数据备份”
- 设置页“审计日志”

常见维护动作：

- 重新生成缩略图
- 清理孤儿文件
- 清理失败任务图片
- 下载离线备份包
- 校验备份包和检查自动备份状态
- 检查最近生成错误

## 常用命令

初始化数据库：

```bash
npm run db:init
```

创建管理员：

```bash
npm run user:create -- admin your-password
```

本地开发：

```bash
npm run dev
```

生产构建：

```bash
npm run build
```

生产启动：

```bash
npm run start
```

Docker 构建启动：

```bash
docker compose up -d --build
```

查看日志：

```bash
docker logs --tail=300 ai-image-web-studio
```

## 故障排查

### 1Panel 拉取镜像失败

如果看到类似：

```text
pull access denied for ai-image-web-studio
```

说明 1Panel 在尝试拉远程镜像。当前项目需要本地 `Dockerfile` 构建，确认上传目录中包含：

```text
Dockerfile
package.json
package-lock.json
app/
components/
lib/
```

### 数据库连接失败

检查：

- `DATABASE_URL` 是否正确
- PostgreSQL 容器是否健康
- 应用容器和 PostgreSQL 容器是否在同一个 Docker 网络
- 连接串中的容器名是否能在应用容器内解析

### 生成任务一直排队或卡住

检查：

- `/api/health`
- 设置页 Key 是否启用
- 设置页“运行设置”里的 Provider Base URL 是否正确；修改后不需要重新构建，新任务会直接使用
- API Key 是否有效
- `GENERATION_TIMEOUT_MS`
- Docker 日志中的 provider 错误

### Docker 构建时 `npm ci` 超时

新版 Dockerfile 默认使用 `NPM_REGISTRY=https://registry.npmmirror.com`，并开启 npm 重试和较长下载超时。若你的服务器访问该镜像源也不稳定，可以在 1Panel 环境变量里改成其他源，例如：

```env
NPM_REGISTRY=https://registry.npmjs.org
```

### 图片加载慢

应用默认优先加载缩略图。若仍然慢，检查：

- 是否正在加载原图
- CDN/反代是否缓存了静态资源
- 首页是否存在大量最近记录
- `storage/thumbnails/` 是否存在缩略图

### 退出登录跳到错误地址

当前版本退出登录使用相对跳转 `/login`，不会再依赖容器内的 `0.0.0.0:3000`。如果仍出现异常，检查反向代理是否改写了 `Location` 头。

## 项目结构

```text
app/                  Next.js 页面和 API 路由
components/           前端组件
lib/                  数据库、队列、provider、存储和备份逻辑
public/               静态资源
scripts/              初始化和启动脚本
storage/              本地图片、缩略图、备份数据
1panel-local-app/     1Panel 本地应用包结构
```

## 安全建议

- 生产环境必须更换 `AUTH_SECRET`。
- 不要把 `.env`、`storage/`、备份包提交到公开仓库。
- 不要把 `.claude/` 等本地 AI 工具配置提交到公开仓库。
- API Key 建议在设置页分多个 Key 管理，便于禁用和轮询。
- 恢复备份前先确认没有运行中的任务。
- 定期下载离线备份包。

更多公开仓库安全说明见 [SECURITY.md](./SECURITY.md)。

## 开源发布

仓库源码可以公开发布，但本地运行数据不应随源码提交。

建议提交源码前确认：

- `.env` 没有进入 Git。
- `.claude/` 等本地工具配置没有进入 Git。
- `storage/` 没有进入 Git。
- `1panel-local-app/` 和 zip 打包产物没有进入 Git。
- 真实 API Key、数据库备份、生成图片和参考图没有进入 Git。
- 已经在服务商后台废弃或轮换曾经泄露过的测试 Key。

## License

Released under the [MIT License](./LICENSE).
