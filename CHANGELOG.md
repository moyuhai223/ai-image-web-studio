# 更新日志

所有重要改动都会记录在这里。后续每次更新代码、配置、部署包或可见行为时，都同步增加版本号并补充本文件。

## [0.5.9] - 2026-05-25

### 修复

- **`/favorites` 卡片缩略图与 `/records` 对齐(1:1 居中裁剪)**:原本 `.record-card .image-open-button { aspect-ratio: 1/1; object-fit: cover }` 只挂在 records 卡片上,favorites 的图按原比例(常见 2:3 竖图)完整撑开,卡片高度参差、视觉与 records 不一致。选择器扩到 `.favorite-card .image-open-button` 共享同一套裁剪规则,两个页面卡片视觉完全统一。
- **`/favorites` 卡片底部 action 一排灰化,与「复制」同款**:原本「详情(灰)/ 重做(蓝)/ 参考(橙)/ 下载(绿)」4 个不同色调显得花。在 `.favorite-card .image-card-actions` 域内覆盖 `--action-color` 为 `color-mix(brand 70%, muted)`(与 `.action-copy` 同款灰调),不影响 `/records` 或这些组件在其他位置的使用。

## [0.5.8] - 2026-05-25

### 变更

- **`/favorites` 头部融合搜索/标签 tab,与 `/records` 视觉完全一致**:`app/favorites/page.tsx` 把原本顶部独占整片 panel-body 的筛选表单收进新的「搜索」抽屉,与「批量管理」并列为「标签」tab,两个 tab 上提到与「收藏作品集」标题同一行。窄屏自动退化为图标+计数胶囊,沿用 v0.5.7 在 `.actions.panel-header-actions` 上挂的容器查询。`searchSummary` 计算同 records:有 tag 显示 `#tag`,有其他筛选显示数字,无筛选不显示 badge。
- **`RecordsToolTabs` 解耦 `useRecordsSelection`,改 prop 注入复用到 favorites**:`components/records-tool-panels.tsx` 不再硬编码读 records 选择上下文,改成 `RecordsToolTabs({ selectedCount?: number })` 由调用方注入。新建 `RecordsToolTabsBridge`(`records-bulk-actions.tsx`)与 `FavoritesToolTabsBridge`(`favorites-bulk-actions.tsx`)两个客户端薄壳,server page 直接挂 bridge 即可。文件名保留以避免无意义大改 import。

### 新增

- **`/favorites` 批量管理(加标签 / 批量取消收藏)**:新建 `components/favorites-bulk-actions.tsx` 镜像 `records-bulk-actions.tsx`:`FavoritesSelectionProvider` + `useFavoritesSelection` + `FavoriteSelectCheckbox({ imageId })` + `FavoritesBulkActions`。「加标签」复用 records 同款 input + `.status action-button action-add`,接 `addTagsToImagesForUser` 仓库函数;「批量取消收藏」用 `HeartOff` 图标 + `.status action-button action-danger`,接新写的 `unfavoriteImagesForUser`(只解除当前用户的收藏关联,不动图、不影响其他用户的收藏,admin 也只清自己的)。危险动作走 `DangerConfirmDialog`,成功后 `router.refresh()` + 清空选择。
- **`POST /api/favorites/bulk` 端点**:`app/api/favorites/bulk/route.ts` 与 `/api/records/bulk` 同款 schema(`{ action: "add_tags" | "unfavorite", ids: string[], tags?: string[] }`),UUID 校验、≤100 条、`requireUser()` 强制登录、`writeAuditLog` 写审计日志(「批量为收藏图片加标签」/「批量取消收藏」),错误走 `respondError`。
- **选中态高亮 outline 共享**:`app/globals.css` 把 `.record-card:has(.record-select-control.selected)` 选择器升级到 `.image-card:has(...)`,records 与 favorites 两种卡片共用同一套 brand 色 outline;同时给 `.favorite-card` 补 `position: relative`(原仅 `.record-card` 有),保证左上角 absolute checkbox 与右上角心型按钮各自就位、不相互遮挡。

## [0.5.7] - 2026-05-25

### 变更

- **`/records` 头部融合搜索/标签 tab + 按钮风格统一**：把原本独立一行的「搜索」「标签」抽屉收起按钮上提到与「生成记录」标题同一行(`app/records/page.tsx` 头部加 `<RecordsToolPanelsProvider>` 包裹，新建 `RecordsToolTabs` 紧凑胶囊放进 `.panel-header .actions`,展开内容 `RecordsToolContent` 仍在 `.panel-body` 顶部独占一行);筛选/重置按钮从原来的 `.button.secondary` (大 CTA 风格) 改为 `.status action-button action-filter` / `.status action-button action-neutral`(13px 图标 + 紧凑胶囊),与卡片上的「复制 / 重做 / 删除 / 详情」一脉相承。`/favorites` 同步换风格。
- **`RecordsBulkActions` 加标签 / 批量删除按钮同款化**：`components/records-bulk-actions.tsx` 把「加标签」从 `.button.secondary` 换 `.status action-button action-add`、「批量删除」从 `.button.danger` 换 `.status action-button action-danger`(图标 13px),与上方筛选/重置 + 卡片 action 三者完全统一。
- **头部 tab 文字自动隐藏**:`app/globals.css` 在 `.actions.panel-header-actions` 上挂 `container-type: inline-size` 容器查询,可用环境下 460px 以下隐藏 tab 文字、只剩图标+计数;不可用环境用 `@media (max-width: 1280px)` 兜底,1281px 以上再让容器查询接管。tab 默认不展示空 badge(`searchSummary` 空字符串 / `selectedCount` 为 0 时跳过渲染),不再有「展开选项」之类占位文案。

### 修复

- **移动端 `/records` 头部不再断成两行**:`app/globals.css` 全局 `.actions { flex-wrap: wrap }` 一直在覆盖新加的 `.panel-header-actions { flex-wrap: nowrap }`(specificity 相同,后者后定义胜出),选择器升级为 `.actions.panel-header-actions`(0,0,2,0) 才稳压住。同时给容器加 `align-items: center` + `min-width: 0`,420px 以下视口隐藏「已筛选 N 项」次要 status 胶囊保留 tab + 总数,移动端「搜索图标 / 标签图标 / 共 N 条」始终一行展示。
- **`RecordsBulkActions` 输入框 + 按钮回归一行**:`.records-bulk-actions` 从与 `.records-bulk-main` 共享的 `flex-wrap: wrap` 规则里拆出,改为独立 `flex-wrap: nowrap`,输入框 `flex: 1 1 140px` 主动收缩、两个 action-button `flex: 0 0 auto white-space: nowrap` 保持原宽,「批量添加标签 / 加标签 / 批量删除」三件套永远同一行;移动端原本强制 `.records-bulk-actions .button { width: 100% }` 拉满规则一并清掉(已无 `.button`)。

## [0.5.6] - 2026-05-24

### 变更

- **宽屏三栏放大 + 超宽居中**：`app/globals.css` `.workspace` 网格列从 `minmax(260px, 320px) minmax(360px, 1fr) minmax(260px, 340px)` 放大到 `minmax(280px, 380px) minmax(420px, 1fr) minmax(300px, 440px)`，1700+ 屏上两侧不再卡死在 320/340 的窄壳里、中间列也保留充足留白；同时为 workspace 加 `max-width: 1760px` + `margin-inline: auto`，避免 4K / 超宽屏被无限拉伸，内容仍处在可读密度。1100px 以下断点继续收为单列，移动端零影响。
- **顶栏内容居中，与正文对齐**：`components/app-nav.tsx` `<header className="topbar">` 内新增 `<div className="topbar-inner">` 包住 brand / nav / 通知中心 / 参考图托盘；`app/globals.css` 把 `.topbar` 拆为外层（仅保留 `position: sticky / 高度 / 背景 / 边框 / blur / shadow`，背景仍贯穿整行）与 `.topbar-inner`（`display: flex` + `padding: 0 24px` + `max-width: 1760px; margin-inline: auto`，与 `.workspace` 完全对齐）。1100px / 520px 两处媒体查询的 `padding` / `gap` 覆盖同步搬到 `.topbar-inner`，避免落空。2K+ 超宽屏上 brand 不再贴左边、与居中的正文左右严格对齐。

## [0.5.5] - 2026-05-23

### 新增

- **品牌渐变 token (`--brand-gradient`)**：`app/globals.css` `:root` 注入 `linear-gradient(135deg, var(--brand), var(--brand-2))` 单一渐变变量，`.brand-mark` 与主 CTA `.button` 共用同一来源，避免散落的 inline `linear-gradient(...)` 写死颜色。`.button:hover` 叠加 `box-shadow` 同色光晕呼应渐变；secondary / danger 按钮保留各自单色渐变 —— 克制即高级。
- **`:focus-visible` 系统化**：`app/globals.css` 全局 `:focus { outline: none }` 重置后，给 `button` / `a` / `summary` / `[role=button|link|tab|menuitem]` / `[tabindex]` 加 `:focus-visible` 规则：`2px solid color-mix(in srgb, var(--brand) 56%, transparent)` + `3px offset` + `border-radius: inherit`。键盘 Tab 导航全程可见焦点环，鼠标点击不残留视觉噪声；文本输入 `.input` / `.textarea` / `.select` 仍保留 `:focus` 边框 + 光晕（无论鼠标还是键盘都需要持续指示编辑目标）。
- **`.num` 等宽数字工具类**：`app/globals.css` 新增 `.num { font-family: var(--font-mono); font-variant-numeric: tabular-nums; letter-spacing: 0; font-feature-settings: "tnum" 1, "zero" 0 }`，应用到：SystemHealthCard 的 p50/p95 / 样本数 / 队列深度 / 成功率 / 24h 任务分布 / Key 总数 / 版本号；`/records` 头部「已筛选 N 项 / 共 N 条」+ 分页「第 N / N 页」；`/favorites` 头部「已筛选 N 项 / 共 N 张」；workspace 队列「运行 N / N · 排队 N」、「percent% · 已保存 N / N 张」、「队列 #N」。混合中英文短语只把数字切到 mono，CJK 仍走正文字体，宽表列对齐 + 排版美感兼得。
- **空状态插画化**：`app/globals.css` 新增 `.empty-state-illustrated`（72px lucide 图标置于 brand 色 `radial-gradient` 圆形底 + 加粗标题 + action 按钮），接入 `/records`（无任何任务时显示 `Image` 图标 + 「前往工作台」CTA；筛选无结果时显示 `Inbox` + 「重置筛选」）和 `/favorites`（无收藏时显示 `Heart` + 「浏览记录找好图」；筛选无结果时显示 `Search` + 「重置筛选」）。先前 `/records` 完全没有空状态（直接渲染空网格），`/favorites` 仅有素文案版本。

### 变更

- **顶栏高度 64px → 56px**：`app/globals.css` `.topbar { height: 56px }`（34px brand-mark + 22px 上下 padding 仍然贴合），主内容区净增 8px。同步收紧所有黏附偏移：`.generation-panel` `top` 84→76、`max-height` `calc(... - 104px)` → `calc(... - 96px)`；`.toast-stack` `top` 78→70；`.settings-nav` `top` 84→76、`max-height` `calc(... - 108px)` → `calc(... - 100px)`；`.settings-section` `scroll-margin-top` 84→76。所有页面长滚动 / 模态 / Toast 的"撞顶不被遮挡"行为保持一致。



### 新增

- **字体栈升级（next/font/google 自托管）**：`app/layout.tsx` 引入 `Inter` / `Noto Sans SC` / `JetBrains Mono` 三套子集，通过 `next/font/google` 在构建期自托管，注入 `--font-sans-latin` / `--font-sans-cjk` / `--font-mono` 三个 CSS 变量；`app/globals.css` 把 body `font-family` 从 `Arial, "Microsoft YaHei"` 替换为「Inter → Noto Sans SC → 系统中文回退（PingFang SC / Hiragino Sans GB / Microsoft YaHei）」分字符回退链，开启 `font-feature-settings: "cv11", "ss01", "ss03"` 启用 Inter 推荐字符变体；`.key-preview` / `.backup-filename` 等等宽场景前置 `var(--font-mono)`，密钥与备份文件名展示更专业。Latin 字符走 Inter，中文走 Noto Sans SC，无需为字重 / 字号特别处理，零运行时网络请求。
- **全局顶部进度条**：新建 `components/navigation-progress.tsx` 客户端组件，监听 `document` 级 click + form submit（capture 阶段，最早拦截）；过滤修饰键 / 中键 / `target=_blank` / `download` / 纯 hash / 跨域 / `javascript:` 协议，仅对真正会触发 App Router 导航的事件起跳 0→80% 进度，路由变化后冲到 100% + 320ms 淡出；`firstRenderRef` 守门防止挂载瞬间闪烁，整体 + Suspense 包裹（`useSearchParams()` 要求）。
- **按钮 Loading spinner**：新建 `components/button-spinner.tsx`（lucide `Loader2` + `animate-spin`），替换 4 个关键按钮的「删除中 / 取消中 / 重试中 / 跳转中」文字 loading：`delete-record-button.tsx`、`job-control-button.tsx`、`rerun-button.tsx`、`danger-confirm-dialog.tsx` 四处统一接入，loading 时 spinner 与文字并排，宽度不抖动。
- **按钮 :active 压感反馈**：`app/globals.css` 末尾追加 `.action-button` 系列 `:active` 状态 `transform: translateY(0) scale(0.96)` + 80ms 过渡，与原有 `.button` 的 scale(0.98) 互补，整套点击反馈连贯一致。
- **滚动条美化**：`app/globals.css` 新增 webkit `::-webkit-scrollbar` 10px 胶囊样式 + Firefox `scrollbar-width: thin` + `scrollbar-color`，hover 加深，长列表 / 模态框 / 详情页全站统一观感，深色背景下不再被默认条占视觉重量。

### 变更

- **记录页按钮统一**：`app/records/page.tsx` 把「详情」`<a>` 加 `<Info size={13} />` 图标，「重做」`<a>` 改用 `<RerunButton />` 组件（与详情页的同一组件），与同行的删除 / 重试 / 取消按钮共享 `.action-button` label 风格。
- **图卡按钮统一**：image-card 「编辑 / 下载」按钮升级到 30px / 1.5px label 风格，与卡片其他控件视觉一致。
- **参考图托盘全局收缩**：`components/reference-basket.tsx` 移除 `MOBILE_REFERENCE_BASKET_QUERY` 媒体查询，桌面端不再自动展开，全部 viewport 默认收缩，需用户主动点击才显示；保留「篮子清空时自动折叠」逻辑。
- **重做按钮 auto-refresh**：requeue 成功后自动 `router.refresh()`，避免任务详情页停留在旧状态。

### 兼容性

- next/font/google 在构建期把字体文件本地化进 `.next/static/media`，运行时不再访问 Google CDN，国内网络无需翻墙；如构建环境同样受限，需自带 fallback 字体文件或改用纯系统字体方案（本版本未提供该开关）。
- 全局进度条用 document 级事件代理，不修补 `window.fetch` / `XMLHttpRequest`，与现有 SSE（队列流）和轮询（自动刷新）零冲突。
- `:active` 压感与现有 `.button:active` 规则并存（CSS 特异性互补），未覆盖任何原有交互。
- 滚动条样式在 Safari / Chrome / Edge / Firefox 全部生效；不支持 webkit 伪元素的少数环境降级到 Firefox `scrollbar-width: thin` 路径，进一步降级仍是浏览器默认条。

## [0.5.3] - 2026-05-23

### 新增

- **运营指标端点**：新建 `lib/metrics.ts` 的 `getOperationalMetrics()`,4 项查询并行(队列深度 + 24h 任务分布、1h/24h 成功率、阶段耗时 p50/p95、Key 池累计成功/失败),全部基于 `generation_jobs` + `app_settings` 现有表实时计算,无新表也无 cron。阶段耗时直接用 PG `percentile_cont(0.5/0.95) within group (...)` + JSONB `#>>` 抽取 `request_metadata.progress.phaseTimings`,10w 行级别也能 sub-100ms。
- **`/api/health/metrics` 双格式输出**:`requireUser()` 后默认返 JSON(供仪表盘),`?format=prometheus` 返 Prometheus 文本格式(Content-Type `text/plain; version=0.0.4`)。指标命名严格遵守规范:`ai_image_studio_queue_depth{state=...}` / `_jobs_total{status=...}` / `_success_rate{window=...}` / `_phase_timing_ms{phase=...,quantile="0.5"}` / `_phase_timing_samples{phase=...}` / `_keys_total{state=...}` / `_key_outcomes_total{outcome=...}` / `_metrics_checked_at_seconds`。所有 null/NaN/Infinity/负数走 `num()` 防御性归零,避免 Prometheus 解析报错。
- **SystemHealthCard 性能指标段**:`components/system-health-card.tsx` 新增 `metrics?: OperationalMetrics | null` 可选 prop,渲染 4 张卡(队列深度 / 24h 成功率 / Key 累计 / 24h 任务分布)+ 阶段耗时 p50/p95 列表(模型等待 / 下载解码 / 入库),底部提示 Prometheus 抓取地址。`app/settings/page.tsx` `Promise.all` 中并行拉取 `getOperationalMetrics()` 与 `getSystemHealth()` 服务器端注入,前端零额外请求。

### 兼容性

- 0.5.2 之前没有 phaseTimings 字段的历史任务,`loadPhaseTimings()` 通过 `request_metadata #> '{progress,phaseTimings}' is not null` 过滤,自然跳过,不影响指标准确性(样本数会从 0.5.0 之后逐步增长)。
- 失败兜底:`getOperationalMetrics()` 整体 `try/catch`,任意子查询失败返回空指标 + `error` 字段,确保健康检查和 Prometheus 抓取永远 200(空指标也是有效的)。
- 审计日志查看器 UI(`components/audit-log-panel.tsx`)在 0.5.x 早期版本已具备完整功能(关键字 / 用户 / 动作 / 时间区间过滤 + 危险确认清空),无需新增。

## [0.5.2] - 2026-05-23

### 新增

- **任务详情显示实际使用的 Preset**：`lib/generation-runner.ts` 的 `providerResults` 类型 + `markSucceeded` 写入 `response_metadata.requests[].presetId/presetName`,填补 0.5.1 的字段断层(`ProviderResult` 早就带,但 runner 漏接住);`app/records/[id]/page.tsx` 新增 `presetLabel()` 与 `asset-meta-grid` 的「Preset」格,优先取实际跑出来的名,退到 `request_metadata.providerPresetId` 前 8 位,最终回落「默认」。
- **Provider Preset 连通性自检**：新建 `app/api/settings/presets/test-connection/route.ts`(admin only,POST `{id}` 或 `{baseUrl}`),5 秒超时探活 `GET {baseUrl}/v1/models`,自动用 `getNextAiApiKey([], presetId)` 选受 preset 绑定影响的可用 key,返回 `{ok, status, latencyMs, baseUrl, keyLabel, error?}` 并写审计日志。`components/presets-manager.tsx` 每行新增「测试连接」按钮,行内展示连通延迟 / HTTP 状态 / 失败原因。

### 变更

- `components/presets-manager.tsx` 默认 Preset 的「删除」按钮从直接隐藏改为 disabled + `title` 提示原因,与「设为默认」的视觉对应;避免「为什么没按钮」的疑惑,同时延续后端 `deleteProviderPreset` 已有的拦截。

### 兼容性

- 0.5.1 已经写入数据库的 `response_metadata.requests[]` 没有 `presetName` 字段,详情页会回退到 `request_metadata.providerPresetId` 短 ID 或「默认」展示,无需迁移历史数据。
- `test-connection` 端点用 `getNextAiApiKey` 同款轮询逻辑,因此严格遵守 preset 绑定:绑到 A 的 key 不会用于测试 B,与生产路径一致。

## [0.5.1] - 2026-05-23

### 新增

- **多 Provider Preset**：`app_settings.provider_settings` JSONB 从 v1（`{version:1, aiBaseUrl}`）懒迁移到 v2（`{version:2, presets:[{id,name,baseUrl,isDefault,createdAt,updatedAt}], activePresetId, legacyAiBaseUrl, legacyMigratedAt}`），首次读时自动包装旧字段为 `id=default` 的默认 Preset 并备份原值，无需 DB DDL。`lib/provider-settings.ts` 提供 `createProviderPreset` / `updateProviderPreset` / `deleteProviderPreset` / `setDefaultProviderPreset` / `resolveProvider(presetId?)` / `listProviderPresetSummaries()` 等 API；`ensureSingleDefault()` 保证任何时刻有且只有一个 `isDefault=true`。删除默认 Preset 抛错，引导先指定新默认。
- **AI Key 按 Preset 绑定**：`ai_key_pool.keys[].presetId` 字段（`null = 通用池，所有 Preset 都能轮询到`），`getNextAiApiKey(excludedIds, presetId)` 用 `isKeyAvailableForPreset()` 过滤；POST `/api/settings/ai-keys` 接受 `presetId`，PATCH 新增 `action: "set-preset"` 分支，可在管理 UI 动态切换 Key 的归属。
- **新 API 端点**：
  - `app/api/settings/presets/route.ts`（admin only）— `GET / POST / PATCH / DELETE`，全部走 `requireAdmin()` + 审计日志；PATCH 支持 `action: "set-default"`。
  - `app/api/presets/route.ts`（普通用户可见，`requireUser()`）— 仅返回 `{id, name, isDefault}` 摘要 + `defaultPresetId`，不暴露 baseUrl，供 workspace 顶部下拉使用。
- **管理 UI**：`components/presets-manager.tsx` 提供 Preset CRUD 表格（名称 / Base URL / 默认徽标 / 更新时间）、行内编辑、设为默认、危险确认删除；接入 `app/settings/page.tsx` 系统状态 tab。`components/ai-keys-form.tsx` 加 `presets` prop，新增"绑定 Preset"下拉，每行 Key 展示当前绑定 + 可在线切换。
- **Workspace 顶部 Preset 选择**：`components/workspace.tsx` 挂载时拉 `/api/presets`，仅在 ≥2 个 Preset 时显示下拉（单 Preset 走隐藏 input），用 `localStorage["ai-image-web-studio:preset-id"]` 记忆用户选择；`<Workspace>` 表单提交时 FormData 自动带上 `presetId`，`/api/generate` 的 zod schema 接受可选 `presetId`，写入 `request_metadata.providerPresetId`。
- **Runner 透传 Preset**：`GenerationRunInput.presetId?: string|null`，`loadGenerationInput()` 从 `job.request_metadata.providerPresetId` 读取；`generateWithProvider(input, { presetId })` 调用 `resolveProvider(presetId)` 选 baseUrl + `getNextAiApiKey(excluded, presetId)` 过滤 key pool；最终错误信息附带 Preset 名称便于排查。
- **健康检查暴露 Preset**：`lib/health.ts` 的 `SystemHealth.provider` 新增 `presets[]` 与 `defaultPresetId`；最近生成错误查询从只看 `status='failed'` 扩展到 `IN ('failed','upstream_error','interrupted')`（弥补 0.5.0 遗漏）；`<SystemHealthCard>` 列出所有 Preset + 默认徽标，错误条目按真实状态展示标签。

### 变更

- `components/system-health-card.tsx` 引入 `generationStatusLabel`，最近错误的状态徽标显示中文（如「上游错误」/「已中断」），不再统一显示「有记录」。
- `components/ai-keys-form.tsx` 新增 `presets` 必填 prop，调用方 `app/settings/page.tsx` 同步注入。

### 兼容性

- v1 → v2 settings 迁移仅在第一次读取时发生，原 `aiBaseUrl` 备份在 `legacyAiBaseUrl` 字段保留一周方便回滚。`setProviderBaseUrl()` 作为旧 `/api/settings/provider` 路由的兼容 shim 保留，直接更新默认 Preset 的 baseUrl。
- 现有 AI Key 的 `presetId` 缺省为 `null`，进入通用池，任何 Preset 都能命中，无需手工迁移。
- 历史任务 `request_metadata.providerPresetId` 为空时，重试走 default Preset，行为与 0.5.0 一致。

## [0.5.0] - 2026-05-23

### 新增

- **SSE 队列推流端点 `app/api/queue/stream/route.ts`**：替代过去 4.5s 一次的 `/api/queue` 轮询。前端通过 `EventSource` 长连接订阅，服务端每 500ms 检查一次 `getActiveQueueStats()` + `listJobsForIds()`，仅在 payload 指纹变化时推送 `update` 事件；25s 内无变化推一条 `: heartbeat` 注释保活；超过 10 分钟自动发 `bye` 事件促使客户端重连。`workspace.tsx` 优先用 EventSource，连续 3 次错误后永久降级回旧轮询，文档隐藏时主动关闭连接释放服务端资源。
- **分段计时埋点**：`lib/generation-runner.ts` 在调用 provider、下载图像 + 落盘、写入 `generated_images` 三个阶段各埋 `performance.now()`，差值累加到 `progress.phaseTimings = { upstream_wait_ms, download_decode_ms, db_insert_ms }`。前端进度条下方实时展示「等待模型 12.0s · 下载 1.2s · 入库 80ms」，便于定位慢在哪一段（模型 vs 网络 vs 数据库）。
- **任务终态细分**：`GenerationStatus` 从 5 值扩展到 7 值，新增：
  - `interrupted` — 服务重启时检测到 `running` 任务，默认从过去的 `running → queued`（容易让用户困惑「任务突然又跑了」）改为标记为该终态。新增 `config.autoRequeueOnRestart`（环境变量 `AUTO_REQUEUE_ON_RESTART`，默认 `false`）开关，true 时退回老行为。
  - `upstream_error` — `markFailed` 调用前用 `mapProviderError(raw).category === "upstream"` 判定，符合时写入新状态而非通用 `failed`。`failureStatusForError(error)` 集中封装该分支判定，runner 和首次入队失败路径都接入。
- **新两态的 UI 全链路覆盖**：
  - `lib/generation-status.ts` 加 `interrupted: "已中断"` / `upstream_error: "上游错误"` 标签，导出 `TERMINAL_GENERATION_STATUSES` / `RETRYABLE_GENERATION_STATUSES` 与 `isTerminalGenerationStatus()` / `isRetryableGenerationStatus()` 工具，5 处独立硬编码的 `isTerminalStatus` 改为统一引用。
  - `app/globals.css` 新增 `.status.interrupted`（橙色）和 `.status.upstream_error`（红色）色系，与原 `.failed` / `.canceled` 视觉风格一致；`.phase-timings` 加 `tabular-nums` 让分段计时数字对齐不抖。
  - `components/job-notification-center.tsx` `statusCopy()` 加这两种状态的中文标题/正文与 icon。
  - `app/records/page.tsx` 状态筛选下拉新增「上游错误」/「已中断」两个选项。
  - `app/records/[id]/page.tsx` 记录详情页 `progressPercent` 与「失败」展示分支识别新两态；重试按钮的可见条件改为 `isRetryableGenerationStatus(status)`，使 `interrupted` / `upstream_error` 默认显示「重试」入口。

### 变更

- `scripts/migrations/003_status_phases.sql`：DROP/重建 `generation_jobs.status` 的 CHECK 约束，加入 `'interrupted'` 和 `'upstream_error'`。`lib/schema.sql` 同步更新（fresh install）。无 DDL 即可扩展 `request_metadata.progress.phaseTimings`（JSONB）。
- `components/workspace.tsx` 顶部首页/批量重做按钮的可见条件从「负向罗列 `failed||canceled||queued||running` 排除」简化为正向 `status === "succeeded"`，避免新加状态被遗漏。

### 风险与回滚

- DB 改动只动 CHECK 约束，无数据迁移。回滚 SQL：`ALTER TABLE generation_jobs DROP CONSTRAINT generation_jobs_status_check; ALTER TABLE generation_jobs ADD CONSTRAINT generation_jobs_status_check CHECK (status IN ('queued','running','succeeded','failed','canceled'));`；回滚前需把 `interrupted` / `upstream_error` 行 `UPDATE ... SET status = 'failed'`。
- SSE 客户端有 3 次错误降级机制，老 `/api/queue` 端点保留，不会因为 SSE 异常导致首页轮询断流。
- `autoRequeueOnRestart=false` 是行为变化：服务重启后 running 任务不再自动回到队列，需手工或自动点「重试」。若用户的部署依赖自动恢复，可设 `AUTO_REQUEUE_ON_RESTART=true` 退回老行为。

## [0.4.40] - 2026-05-23

### 修复

- Image 2 编辑接口的 base64/url 兜底链：v0.4.37 重写时把触发条件写成了 `"provider returned no images"`（复数），但 v0.4.37 同时把单图编辑流程的报错改成 `"Provider returned no edited image"`（单数），导致单图编辑失败时根本不会触发 fallback。`lib/provider.ts` 的 `shouldTryBase64Fallback` 改为匹配 `"provider returned no"` 前缀，单复数都能触发兜底。

### 变更

- 上游错误归一化：新增 `lib/provider-error-map.ts` 把 `auth_unavailable`、`no auth available`、`Provider returned no edited image`、`HTTP 4xx/5xx`、`ETIMEDOUT`、`fetch failed` 等 14 类原始错误翻译成带建议的中文文案。失败任务的 `error_message`（前端记录页和首页错误条都会显示）从过去的英文堆栈片段变成「上游服务对该模型未配置认证（建议：联系服务商确认...）」之类可操作的提示。未命中的错误模式仍保留原 message，便于排查未知错误。
- 生成 API 提前 429 守门：原本只检查 `queued`，现在用 `getActiveQueueStats()` 同时核算 `queued + running`，超过 `MAX_GENERATION_QUEUE_SIZE` 直接返回 `{ status: 429, code: "queue_full", retryAfterSeconds: 30 }` + `retry-after` 响应头。前端识别该 code 后会展示「约 30 秒后可再次尝试」。
- 参考图限制从硬编码挪到 config：`lib/config.ts` 新增 `maxReferenceImages`（环境变量 `MAX_REFERENCE_IMAGES`，默认 4）和 `allowedImageMimes`（环境变量 `ALLOWED_IMAGE_MIMES`，默认 `image/png,image/jpeg,image/webp`）。`lib/validation.ts` 的 `allowedImageTypes` 改为按 config 派生。`app/api/generate/route.ts` 与 `components/workspace.tsx` 不再各自维护 `const MAX_REFERENCE_IMAGES = 4`，前端通过新建的 `app/api/config/limits/route.ts` 拉取运行时配置。

### 新增

- `app/api/config/limits/route.ts`：公开的 GET 端点，返回 `{ maxReferenceImages, allowedImageMimes, maxUploadMb }`，让客户端拿到服务端配置（客户端不能直接 import `lib/config`，那是 Node-only 的）。

## [0.4.39] - 2026-05-23

### 变更

- 新增 `lib/logger.ts`：零依赖结构化 logger，统一 server 端 24 处 `console.*` 调用。日志现在带统一时间戳、级别（`debug`/`info`/`warn`/`error`）和模块名（`provider` / `queue` / `runner` / `api-error` 等），错误对象自动展开为 `{name, message, stack}`。
- 支持环境变量配置：`LOG_LEVEL`（默认 `info`）按级别过滤，`LOG_FORMAT=json` 切换到单行 JSON 输出（容器/日志聚合场景）。默认 text 格式对开发者友好。
- 涉及文件：`lib/api-errors.ts` / `audit-log.ts` / `data-backup.ts` / `db.ts` / `generation-queue.ts` / `generation-runner.ts` / `provider.ts` / `ui-theme.ts` / `app/api/health/route.ts`。
- 客户端组件（`workspace.tsx` 等）和 CLI 脚本（`start-production.mjs` 等）保留 `console.*`：前者直接给浏览器 DevTools 看不需要结构化，后者是进程入口且跨 `.ts`/`.mjs`。

## [0.4.38] - 2026-05-23

### 安全

- 统一所有 `app/api` 路由的错误处理：原本 500 catch 直接把 `error.message` 写回响应体（包含 SQL、文件路径、堆栈片段等内部细节），改为对外返回通用提示 + 服务端 `console.error` 记录完整错误。
- 新增 `lib/api-errors.ts`：`ApiError(message, status)` 显式标记面向用户的可见错误，`respondError(error, { context, fallbackStatus })` 统一封装响应，500 路径强制掩码、400 路径仍透传 lib 抛出的中文提示。
- 涉及路由：`audit-logs` / `storage-maintenance` / `records/bulk` / `backups`（含 `policy` `restore` `validate`）/ `settings/provider` / `settings/ai-keys`，共 9 个文件、~13 处 catch。
- `backups/restore` 与 `backups/validate` 内部的输入校验改用 `ApiError(msg, 400)` 显式抛出（原本被 catch 后统一返回 500，用户看不到真实原因）。

### 修复

- `scripts/start-production.mjs` 加入 graceful shutdown：SIGTERM / SIGINT / SIGHUP 转发给 Next.js server.js，25 秒未退出 SIGKILL 强制清理，避免容器停止时丢请求 / 连接泄漏。
- `lib/db.ts` 新增 `closePool()` 导出，便于上层在退出前主动释放 PG pool。

## [0.4.37] - 2026-05-23

### 修复

- 重写 Image 2 编辑接口 (`/v1/images/edits`) 调用逻辑：去除默认强制的 `response_format=url`，让 provider 按 `gpt-image-1` 新规范返回 b64_json，避免严格按规范实现的 provider 直接 400。
- Image 2 编辑失败时新增 base64 → url 兜底链：首次默认请求失败且命中 `400/404/405/422` 或 `response_format / unsupported / no images` 等错误时，自动重试 `response_format=b64_json`，再失败才尝试 `response_format=url`，减少单点失败。
- 参考图预处理改为按需触发：原生 PNG/JPEG/WebP 且 ≤1536 边长 ≤4MB ≤ 无 EXIF 旋转时直接透传原文件，避免无意义的 PNG 转码导致 payload 膨胀和大图 multipart 超限。
- 参考图 sharp 处理失败时降级为原文件提交（只要 mime 受支持），不再因 sharp 单点报错让整个任务直接失败。
- 参考图文件名扩展名匹配真实 mimeType（之前所有参考图都强制叫 `.png`，可能让严格校验的 provider 直接拒收）。
- Image 2 编辑错误信息附加诊断元数据（`refs=N payload=KB size=... model=...`），方便后续日志定位是参考图大小、尺寸还是模型本身的问题。

## [0.4.36] - 2026-05-22

### 修复

- 修复手动取消运行中任务后，本地 worker 并发槽可能仍被旧 provider 请求占用，导致新任务停在 `5%` 等待后台 worker 的问题。
- 队列 drain 前会同步数据库里的真实运行状态，自动释放已经取消、失败或完成的本地任务占用。
- 取消任务后会主动唤醒后台队列，让后续排队任务更快进入处理流程。

## [0.4.35] - 2026-05-22

### 修复

- 重写 Image 2 / Banana 2 编辑分流：`gpt-image-*` 只走图片生成/编辑接口，`Nano Banana 2` 只走 chat 多模态流程，避免两个模型互相兜底影响。
- Image 2 编辑提交前会将参考图清洗为 PNG，并限制最长边 1536，减少大图、WebP、图片元数据异常导致 provider 长时间等待的问题。
- 生成流程文案会明确显示当前提交到 Image 2 编辑接口、Image 2 生成接口或 Banana 2 多模态流程，方便定位卡在哪个 provider 流程。

## [0.4.34] - 2026-05-22

### 修复

- 记录页卡片右上角“详情”按钮补齐统一的 `action-detail` 样式。
- 首页任务队列里的“详情”按钮补齐统一样式。
- 任务详情页版本链中的“详情 / 编辑 / 下载”按钮统一为轻量胶囊操作按钮。
- 记录卡片和详情页图片操作区按钮统一高度、描边和悬停样式，让“重做 / 参考 / 收藏 / 编辑 / 下载 / 删除”等按钮视觉一致。

## [0.4.33] - 2026-05-22

### 优化

- 生成进度新增 `referenceCount` 字段，任务详情页会优先使用实际 runner 读取到的参考图数量。
- 等待模型返回时的进度文案从“正在提交请求”优化为“模型请求已发送，正在等待图片返回”，避免 15% 阶段看起来像请求没有发出。

### 修复

- 修复任务详情页在已读取到参考图时仍可能显示“无参考图，跳过读取参考图”的流程显示错误。
- 对已在运行中的旧任务增加进度文案兜底解析，可从“参考图 1 张”等文字中恢复参考图数量显示。

## [0.4.32] - 2026-05-22

### 修复

- 修复 Image 2 编辑接口返回 `data:image/...;base64` 放在 `url` 字段时，被当作普通远程 URL 处理的问题。
- 已用临时 Key 验证 `gpt-image-2` 单参考图和多参考图 `/v1/images/edits` 请求均可返回图片，返回结构为 `data[0].url = data:image/png;base64,...`。

## [0.4.31] - 2026-05-22

### 修复

- 任务详情页顶部“重做”按钮补齐统一的轻量胶囊按钮样式，与记录页、收藏页和首页最近记录保持一致。
- Image 2 和 Banana 2 的图片编辑/生成流程改为按模型显式分流：`gpt-image-*` 走图片生成/编辑接口，`Nano Banana 2` 走 chat 图片流程，避免两个模型互相影响。
- Image 2 编辑结果新增嵌套图片结构兜底解析，provider 返回非标准 `data` 结构时不再直接误判为无图片。

## [0.4.30] - 2026-05-22

### 优化

- 设置页按钮统一为轻量胶囊操作样式，覆盖 Provider、AI Key、用户、提示词模板、参考图、数据备份、存储维护、审计日志、更新检查和确认弹窗。
- 按保存、新增、刷新、筛选、校验、下载、恢复、危险操作等语义重新配色，让设置页按钮和记录页、详情页操作按钮保持一致。

### 修复

- 修正应用内部版本常量滞后问题，设置页、健康检查和更新检查现在会显示当前 `v0.4.30`。

## [0.4.29] - 2026-05-22

### 优化

- 首页生成表单里的参考图区域默认收缩，只显示当前参考图数量，手动展开后再选择、排序或清空参考图。
- 移动端右下角悬浮参考图篮默认折叠，加入图片后不再自动遮挡页面，手动点击后展开；桌面端仍保留自动展开体验。
- 记录卡片、详情页、收藏页和最近记录的操作按钮统一为轻量胶囊样式，并按重做、参考、收藏、编辑、下载、删除、取消等操作重新配色。
- 删除、取消等操作按钮不再显示状态圆点，状态标签仍保留圆点以区分成功、失败、运行中等任务状态。

### 修复

- 修复 Banana 2 / Gemini 风格图片返回在 chat 兜底路径下可能被误判为“Provider response did not contain an image”的问题，新增对 `inlineData`、`inline_data`、`source.data` 和 `image_generation_call.result` 图片结构的识别。
- 明确右下角参考图篮不会自动计入本次任务；只有导入到首页参考图区域的图片才会写入任务记录。

## [0.4.28] - 2026-05-22

### 优化

- 生成流程新增“读取参考图、提交模型、接收结果”等细分阶段，任务详情页可以更清楚看到当前卡在哪一步。
- 后台任务会在参考图读取完成后写入“参考图已准备完成”提示，多参考图会显示提交数量。
- 失败信息新增阶段前缀，例如读取参考图失败、等待模型返回失败、读取模型返回图片失败、保存图片到本地失败，便于定位 `stream disconnected` 等问题。
- 队列慢请求提醒和超时判定兼容新的“提交模型”阶段。
- 本地生成的带版本号 1Panel zip 包加入忽略规则，避免发布附件误进 Git。

## [0.4.27] - 2026-05-21

### 优化

- 对比预览改为按图片比例自适应边界，避免左右对比列被撑满后出现大面积空白。
- 对比预览支持鼠标滚轮、按钮、双击和触控手势同步缩放，拖动时左右两张图同步平移。

## [0.4.26] - 2026-05-21

### 新增

- 任务详情页编辑生成图支持点击图片后自动进入左右对比预览，左侧显示主修改图，右侧显示成品图。
- 对比预览支持切换回单图预览；移动端自动改为上下对比布局。

### 优化

- 编辑图图片卡片新增“可对比”状态提示，普通生成图仍保持原有大图预览体验。

## [0.4.25] - 2026-05-21

### 修复

- 修复移动端加入参考图后参考图篮展开层被顶部导航栏影响，遮挡页面顶部内容的问题。
- 参考图篮改为渲染到页面根层，并让展开面板固定在右下角按钮上方显示。

## [0.4.24] - 2026-05-21

### 新增

- 新增跨页面“参考图篮”，记录页、收藏页、详情页和首页结果图可把已生成图片加入同一个参考图篮。
- 参考图篮支持最多 4 张图片、跨分页保留、调整顺序、移除、清空，并可一键带入首页生成区。

### 优化

- 记录页和收藏页卡片底部操作保持 4 个主要按钮一排，加入参考图入口使用“参考 / 已选”状态按钮，避免按钮布局拥挤。

## [0.4.23] - 2026-05-21

### 优化

- 全局模型请求硬超时时间从 10 分钟延长到 15 分钟，减少多参考图编辑和复杂任务被过早判定失败的情况。
- `docker-compose.yml`、`.env.example`、README 和 1Panel 本地应用参数默认值同步改为 `900000` 毫秒。

## [0.4.22] - 2026-05-20

### 新增

- 生成页支持最多 4 张参考图，可混合上传图片、参考图库图片和已生成图片作为编辑参考。
- 多参考图会按界面顺序提交，第一张作为主参考图，并支持上移、下移、移除和清空。
- 后端生成任务新增 `references` 数组，同时保留旧 `reference` 字段兼容历史记录。
- `gpt-image-2` 多参考图请求改为在 `/v1/images/edits` 中多次 `append("image", ...)`。

### 修复

- 修复生成记录页底部操作区被通用 `.actions` 样式覆盖，导致 4 个按钮没有保持同一行的问题。
- 参考图使用统计、未使用清理和重复合并逻辑兼容新的多参考图数组。

## [0.4.21] - 2026-05-20

### 优化

- 首页最近记录改为点击缩略图进入任务详情，移除操作区里的“详情”按钮，底部操作保持 4 个按钮一排。
- 生成记录页将“详情”移动到状态行右侧，底部保留重做、收藏、编辑、删除等 4 个主要操作。

### 修复

- 修复生成记录页“本页全选”后图片卡片左上角勾选状态不明显的问题，选中卡片现在会显示清晰勾选和描边。

## [0.4.20] - 2026-05-20

### 优化

- 生成记录页“搜索 / 标签”工具区改为受控互斥展开，点击一个会自动收起另一个。
- 移动端“搜索 / 标签”入口保持同一行显示，展开内容占用整行宽度。
- 标签批量操作面板新增已选记录列表、单条取消和清空选择，让本页全选后可以明确取消不需要的记录。

## [0.4.19] - 2026-05-20

### 优化

- 生成记录页将搜索筛选和批量标签操作合并为同一行折叠工具区，默认只显示“搜索 / 标签”摘要，点击后展开对应选项。
- 批量选择改为受控选择状态，本页全选后可以继续手动取消任意单条记录。

## [0.4.18] - 2026-05-20

### 新增

- 设置页改为分组分页显示，点击菜单只显示当前分组内容，维护操作不再被长页面挤到下方。
- 审计日志新增关键词、用户、动作、对象类型、时间范围和返回数量筛选。
- 审计日志新增清空功能，使用统一危险操作确认弹窗，并在清空后保留一条清空记录。

### 优化

- Provider 配置改为通用 `PROVIDER_BASE_URL` 和 `PROVIDER_API_KEY`，代码、文档和 1Panel 表单不再写死具体服务地址或旧变量名。

## [0.4.17] - 2026-05-20

### 优化

- 参照 `1panel-app-adapter` 的规则优先思路刷新 1Panel 本地应用包结构。
- 新增可追踪的 `packaging/1panel` 模板，包含根 `data.yml`、版本级 `data.yml`、`source-evidence.json`、README、logo 和生命周期脚本。
- Release 自动打包会同时输出版本根目录的 `docker-compose.yml`、`.env.sample` 和 `scripts/*.sh`，并保留 `source/` 源码构建方式。
- `docker-compose.yml` 改用 `PANEL_APP_PORT_HTTP` 作为 1Panel 表单端口变量，并保留 `1panel-network` 外部网络。
- 1Panel 包和 Docker 构建上下文排除 `.claude/` 本地工具配置，避免上传到公开包或仓库。

## [0.4.16] - 2026-05-20

### 新增

- 新增 GitHub Actions Release 工作流，推送 `v*.*.*` 标签后自动构建并发布 1Panel 本地应用 zip。
- 设置页新增“版本更新”卡片，可检查 GitHub 最新 Release、查看更新说明和下载附件。
- 新增 `/api/update-check`，管理员可通过网页检查当前版本与 GitHub 最新版本。

### 优化

- 新增 `GITHUB_REPOSITORY_SLUG` 配置，默认指向 `moyuhai223/ai-image-web-studio`，方便 fork 后改为自己的仓库。
- README 增加在线更新和 Release 发布说明。

## [0.4.15] - 2026-05-20

### 新增

- 增加 MIT 开源协议文件，便于公开发布到 GitHub。
- 增加 `SECURITY.md`，说明 Key、`.env`、本地图片和备份包不要提交到公开仓库。

### 优化

- 补强 `.gitignore`，默认排除 `.env`、本地存储、1Panel 打包目录、zip 包、构建缓存和系统临时文件。
- `package.json` 增加 `license` 字段，明确项目开源协议。

## [0.4.14] - 2026-05-19

### 优化

- 1Panel 本地应用包改为只保留最新版本目录，不再把历史版本一起打进 zip。
- 清理历史打包目录，减少上传、解压和重新打包耗时。

## [0.4.13] - 2026-05-19

### 新增

- 设置页“运行设置”新增 Provider Base URL 输入框，管理员可直接在网页里修改 `PROVIDER_BASE_URL`。
- 新增 `/api/settings/provider` 管理接口，Base URL 保存到 `app_settings`，并写入审计日志。

### 优化

- 生图请求改为任务执行时读取当前 Provider Base URL，设置页保存后新任务立即生效，无需重新构建镜像。
- 健康检查会显示当前 Base URL 的来源：设置页保存或 `.env` 默认值。

## [0.4.12] - 2026-05-19

### 优化

- Docker 构建阶段默认使用 `https://registry.npmmirror.com`，降低服务器执行 `npm ci` 时访问 npmjs 超时的概率。
- Dockerfile 增加 npm 拉包重试、下载超时和 `replace-registry-host=always`，让 lockfile 中的 npmjs tarball 也跟随镜像源。
- `docker-compose.yml` 新增 `NPM_REGISTRY` build arg，可在 1Panel 环境变量里自定义 npm 源。
- README 增加 `npm ci` 超时排查说明。

## [0.4.11] - 2026-05-19

### 优化

- 生成任务增加慢响应软提醒：模型请求超过 5 分钟仍未返回时，进度文案会提示“仍在等待返回”。
- 软提醒不会把任务判失败，硬失败仍按 `GENERATION_TIMEOUT_MS`，默认 10 分钟。
- 硬超时改为按本次模型请求开始时间计算，避免软提醒更新进度后把失败时间顺延。

## [0.4.10] - 2026-05-19

### 优化

- 生成任务默认硬超时时间从 5 分钟延长到 10 分钟，减少复杂图片或 provider 慢响应时被误判失败。
- `docker-compose.yml`、`.env.example` 和 README 中的 `GENERATION_TIMEOUT_MS` 默认值同步改为 `600000`。

## [0.4.9] - 2026-05-19

### 新增

- 提示词模板占位符支持连续编辑：在提示词输入框按 `Tab` 跳到下一个 `{...}`，`Shift + Tab` 跳到上一个。
- 首页生成按钮上方新增生成前确认条，集中显示模型、尺寸、数量和参考图状态。
- 生成记录页新增筛选记忆，返回记录页时会自动恢复上次筛选条件，点击“重置”会清除记忆。

### 优化

- 首页参考图状态合并为单个“当前参考图”卡片，明确显示来源：上传文件、参考图库或从生成图编辑。
- 设置页将“存储维护”和“数据备份”合并到“维护操作”，把危险维护动作集中放在更靠后的分组。

## [0.4.8] - 2026-05-19

### 优化

- 生成记录页的搜索筛选改为默认折叠，未筛选时只保留一条紧凑入口，节省移动端首屏空间。
- 生成记录页存在筛选条件时自动展开筛选区，方便查看和调整当前条件。
- 设置页账号管理移动端布局优化，每个账号的状态、角色和密码操作合并为紧凑行，减少纵向占用。

## [0.4.7] - 2026-05-19

### 优化

- 首页提示词模板“填入 / 追加”后，会自动聚焦提示词输入框。
- 插入模板后自动选中新插入内容里的第一个 `{...}` 占位符，包含大括号，可直接输入替换。

## [0.4.6] - 2026-05-18

### 新增

- 提示词模板支持来源信息，记录来源 Key、来源名称、来源链接和授权说明。
- 设置页“提示词模板”新增“导入精选库”，可一键同步一批参考 EvoLinkAI GPT Image 2 提示词库整理的本地精选模板。
- 新增 `002_prompt_template_sources` 数据库迁移，升级部署会自动补齐模板来源字段和来源唯一索引。

### 优化

- 精选模板导入支持重复执行：已有来源模板会更新内容，不会重复创建。
- 模板列表会显示来源链接，方便后续追溯和手动查看原始提示词库。

## [0.4.5] - 2026-05-18

### 新增

- 新增数据库迁移系统，启动和 `npm run db:init` 会在 `schema.sql` 后按序执行 `scripts/migrations/*.sql`。
- 新增 `schema_migrations` 记录表，保存迁移编号和校验值，避免同名迁移内容被悄悄修改。
- 新增 `npm run db:migrate` 命令，方便部署后手动执行迁移检查。

### 优化

- 数据恢复的图片目录替换改为双缓冲流程：先恢复到新目录，准备完成后再切换正式目录。
- 图片目录切换失败时会尝试回滚旧目录；若回滚不完整，会保留旧目录并报出位置，降低恢复中断导致文件丢失的风险。

## [0.4.4] - 2026-05-18

### 优化

- 收藏作品集新增筛选栏，支持按关键词、标签、模型、尺寸和收藏时间筛选。
- 收藏作品集分页会保留当前筛选条件，跳页后不丢失搜索状态。
- 收藏作品集内点击图片标签会留在收藏页筛选，不再跳到全部记录页。
- 首页右侧最近记录新增收藏按钮，生成完成后可以直接把首图加入作品集。

## [0.4.3] - 2026-05-18

### 新增

- 新增图片收藏功能，生成结果、记录页和任务详情页可收藏图片。
- 新增“收藏作品集”页面，集中查看、翻页、下载、编辑和管理已收藏图片。
- 数据备份支持导出和恢复图片收藏表，避免恢复后作品集丢失。

### 优化

- 任务详情页图片卡片升级为资产信息卡，展示尺寸、文件大小、生成耗时、模型、Key 标签、原图/编辑链路和标签。
- 新生成任务会记录使用的 Key 标签，后续详情页可直接查看。
- 移动端设置页分组改为可折叠面板，减少长页面滚动压力。

## [0.4.2] - 2026-05-18

### 优化

- 移动端首页提示词模板的“填入 / 追加”按钮合并为同一行两列显示，减少表单高度占用。
- “填入 / 追加”按钮增加不同强调色，便于移动端快速区分两个操作。

## [0.4.1] - 2026-05-18

### 修复

- 修复生成时上传多张参考图可能复用同一个本地文件名，导致后上传的参考图覆盖前一张、参考图缩略图串台的问题。
- 保存图片文件时改为排他写入，遇到同名文件会自动追加随机后缀，避免任何来源意外覆盖已有图片。
- 缩略图缓存版本从 `v2` 升级到 `v3`，让浏览器和本地旧缩略图缓存失效，重新按当前源文件生成缩略图。

## [0.4.0] - 2026-05-18

### 新增

- 数据备份增加“校验 / 上传校验”，可在恢复前检查备份包 manifest、数据库表行数、图片文件数量和体积。
- 数据备份增加自动备份策略，可在设置页配置启用状态、备份间隔和本地保留份数。
- 新增管理操作审计日志，记录备份、恢复、自动备份策略、Key、用户、模板、参考图、存储维护和记录操作。
- 记录页新增批量操作栏，支持本页选择、批量添加图片标签和批量删除生成记录。

### 优化

- `/api/health` 会触发轻量自动备份检查，配合 Docker healthcheck 即可驱动定时备份。
- 备份包恢复接口统一错误路径，参数错误不再混用响应对象和恢复结果。
- 数据备份包会包含审计日志表，恢复旧版本备份时缺失审计日志会按空表兼容。

## [0.3.35] - 2026-05-18

### 修复

- 修复移动端设置页分组菜单没有固定在顶部、滚动后悬在内容中间并遮挡标题的问题。
- 修复移动端设置页分组菜单图标条横向错位，改为固定在应用顶栏下方并为内容补足顶部间距。
- 修复退出登录时在 Docker/反代环境下跳转到 `https://0.0.0.0:3000/login` 的问题，退出后统一回到当前域名的 `/login`。

## [0.3.34] - 2026-05-17

### 新增

- 数据备份新增在线恢复功能，可从服务器已有备份包直接恢复。
- 数据备份支持上传外部 `.tar.gz` 备份包并恢复，上传后的备份包会保存到 `storage/backups/`。
- 新增 `/api/backups/restore` 接口，用于备份包校验、解包和恢复。

### 优化

- 恢复前会检查当前是否存在排队或运行中的生成任务，存在任务时拒绝恢复，避免后台任务继续写入旧数据。
- 恢复流程会先解包到临时目录并校验 `manifest.json`，再恢复数据库和图片目录。
- 执行恢复前会自动创建一份当前数据安全备份，方便误操作后回退。

## [0.3.33] - 2026-05-17

### 新增

- 设置页新增“数据备份”功能，管理员可以创建、下载和删除服务器本地备份包。
- 备份包保存到 `storage/backups/`，格式为 `.tar.gz`，包含数据库核心表、`schema.sql`、生成图片、参考图和缩略图。
- 新增 `/api/backups` 与 `/api/backups/[filename]` 接口，用于备份列表、创建、删除和下载。

### 优化

- 数据备份删除复用统一危险操作确认弹窗，避免误删备份文件。
- 设置页导航新增“数据备份”分组，方便从管理后台直接进入。

## [0.3.32] - 2026-05-17

### 优化

- 新增共用危险操作确认弹窗，统一复用删除确认弹窗的视觉样式。
- 任务取消/重新排队、AI Key 删除、提示词模板删除、参考图删除/清理/合并、存储维护清理操作均改为站内确认弹窗。
- 移除剩余浏览器原生 `confirm` / `alert`，失败信息会直接显示在确认弹窗内。

## [0.3.31] - 2026-05-17

### 优化

- 记录页列表卡片支持直接编辑缩略图对应图片的标签，不再必须进入任务详情页。
- 记录页列表会读取缩略图自身标签作为编辑初始值，任务聚合标签仍用于标签筛选和搜索。

## [0.3.30] - 2026-05-17

### 新增

- 已生成图片支持图片级标签：每张生成图可以单独手动添加、删除和保存标签。
- 标签编辑支持读取历史标签，点击历史标签即可快速添加到当前图片。
- 记录页新增标签筛选，点击图片标签会进入对应标签搜索结果。
- 记录页卡片展示任务下图片的聚合标签，任务详情页和首页生成结果图片卡片可直接编辑图片标签。
- 新增 `/api/tags` 和 `/api/images/[id]/tags` 接口，用于标签历史读取和图片标签保存。

## [0.3.29] - 2026-05-17

### 修复

- 修复移动端画廊主题下首页仍使用双列工作区导致“结果预览”和“任务队列”横向溢出的问题。
- 移动端结果预览、任务队列、进度条和队列卡片增加宽度约束，避免长提示词或占位内容撑出屏幕边界。
- 移动端结果预览占位层和进度信息改为按容器宽度收缩，减少右侧留白和横向滚动。

## [0.3.28] - 2026-05-17

### 优化

- 生成记录删除确认从浏览器原生弹窗改为站内自定义确认弹窗，视觉风格与当前面板一致。
- 删除失败时错误信息会直接显示在确认弹窗内，不再使用浏览器 alert。
- 删除确认支持点击遮罩、关闭按钮或 Esc 取消，删除中会禁用取消操作避免重复提交。

## [0.3.27] - 2026-05-17

### 新增

- 记录页大图预览支持跨页翻图：当前页最后一张继续下一张时跳到下一页并自动打开第一张，当前页第一张继续上一张时跳到上一页并自动打开最后一张。

### 优化

- 跨页预览保留当前记录页筛选条件，第一页不会继续向前跳，最后一页不会继续向后跳。

## [0.3.26] - 2026-05-16

### 修复

- 修复首页右侧最近记录在窄宽度下状态标签被挤成竖排的问题，状态和复制按钮现在固定不换行。
- 修复最近记录操作按钮隐藏后仍占据卡片高度的问题，鼠标环境下操作区改为悬浮层，卡片不再出现大块空白。
- 优化最近记录顶部信息行的网格排布，模型和用户信息保持单行截断，缩略图与内容顶部对齐。

## [0.3.25] - 2026-05-16

### 优化

- 首页生成表单改为“提示词 / 参数 / 参考图”分区面板，参数信息更集中，长时间使用时更容易扫读。
- 参考图区域改为横向小图选择器，最多展示最近 5 张参考图缩略图，上传参考图后会有明确的已选择提示。
- 结果预览空状态增加图片占位层和提示说明，未生成时也能保持稳定的预览区域视觉。
- 首页最近记录改成更偏画廊的小卡片布局，缩略图更大，提示词和元信息保持截断，操作按钮在鼠标悬停时出现。
- 生成状态标签统一改为中文，首页、记录页和详情页展示一致。

## [0.3.24] - 2026-05-16

### 优化

- 首页任务队列刷新改为自适应轮询：有排队或运行任务时保持 3.5 秒刷新，无任务时降为 25 秒刷新，减少空闲页面对服务器的请求。
- 页面切到后台或标签页不可见时暂停首页队列刷新和任务状态轮询，回到前台后立即刷新队列并恢复未完成任务轮询。
- 队列刷新遇到临时请求失败后仍会继续安排下一次低频刷新，避免一次网络抖动后停止更新。

## [0.3.23] - 2026-05-16

### 新增

- 首页生成区新增“最近参考图”快捷选择卡片，显示当前用户最近一张参考图缩略图，点击后直接作为已有参考图使用。

### 优化

- 存储维护里的“重新生成缩略图”现在同时覆盖生成图和参考图，参考图缩略图异常时可通过该按钮统一刷新。
- 存储维护扫描统计中的预期缩略图、缺失缩略图和孤儿文件判断同步纳入参考图缩略图，避免参考图缩略图被误判为孤儿文件。

### 修复

- 参考图文件接口允许普通用户读取自己上传的参考图，管理员仍可读取全部参考图；使用已有参考图生成时同步校验所有权，避免成员引用他人的参考图 ID。

## [0.3.22] - 2026-05-15

### 新增

- 大图接口新增 HTTP Range 支持：生成图片原图、参考图原图和下载接口现在支持 `Range: bytes=start-end`，可返回 `206 Partial Content`。
- Range 响应新增 `Accept-Ranges`、`Content-Range`、`Content-Length`、`ETag` 和 `Last-Modified` 头，支持浏览器/代理按需加载大图或断点下载。
- 新增 `If-Range` 校验：客户端缓存校验值不匹配时自动退回完整文件响应，避免返回过期分片。

### 优化

- 本地文件流支持按字节区间读取，减少大图预览和下载时的无效传输；缩略图仍保持现有缓存返回逻辑。

## [0.3.21] - 2026-05-15

### 优化

- 新增统一的生成图片清理服务，集中处理原图、缩略图和 `generated_images` 记录删除，供记录删除、重新排队和失败任务图片清理复用。
- 记录删除改为先删除本地图片文件，再删除图片记录，最后删除任务记录；如果文件删除失败，任务记录会保留，避免产生不可追踪的孤儿文件。
- 失败/取消任务重新排队前会先清理旧图片，旧图清理失败时不重新入队，避免旧图片和新结果混在同一任务里。
- 存储维护里的“清理失败任务图片”复用统一清理服务，成功删除的图片记录才会从数据库移除，失败项保留供下次重试。

### 修复

- 移除旧的 `deleteJobForUser` / `requeueJobForUser` 危险入口，避免后续误用先删数据库、后删文件的旧流程。

## [0.3.20] - 2026-05-15

### 优化

- 优化参考图管理列表的使用记录查询：保留分页加载，改用分页参考图集合 + 窗口聚合一次性计算使用次数、最近使用时间和最近 5 条关联任务，减少对 `generation_jobs` 的重复扫描。
- 新增 `reference_images_created_idx` 与 `generation_jobs_ref_path_created_idx` 索引，加速参考图分页排序和按参考图路径查找最近生成任务。
- 图片原图与下载接口改为流式响应，避免大图返回时将完整文件一次性读入内存；缩略图继续使用缓存文件返回。

### 修复

- 修复参考图原图接口已引入 `streamStoredFile` 但仍调用未导入 `readStoredFile` 的构建风险。
- 修复参考图管理面板刷新按钮直接绑定分页加载函数导致的 TypeScript 构建错误。

## [0.3.19] - 2026-05-15

### 新增

- 重复参考图合并功能：按 checksum 识别内容相同的参考图，一键合并保留最早一条，关联的生成记录自动迁移到保留记录，多余文件自动清理释放空间。

### 优化

- 参考图上传自动去重：相同文件（SHA-256 checksum 匹配）不再重复存储，直接复用已有记录，节省磁盘空间。
- 参考图管理面板新增重复标记：checksum 相同的参考图显示黄色「重复」徽章，方便识别和清理。
- 参考图缩略图支持点击灯箱预览原图，复用全站 ImageLightbox 组件，支持缩放、拖拽、键盘操作。
- 关联生成记录查询限制返回最近 5 条，避免高频使用的参考图返回过大数据。
- 批量清理未使用参考图改为逐条操作（先删文件再删记录），避免文件删除失败时 DB 记录丢失造成孤儿文件。
- 新增 `generation_jobs_ref_path_idx` 索引优化参考图使用分析查询性能（JSONB `request_metadata -> 'reference' ->> 'localPath'`）。
- 新增 `reference_images_checksum_idx` 索引加速上传去重查询。

## [0.3.18] - 2026-05-15

### 新增

- 参考图管理面板全面增强：缩略图加载（不再加载全尺寸图片）、使用状态分析（「已使用 ×N」/「未使用」徽章）、关联生成记录展开查看（最多 5 条，可跳转详情页）。
- 参考图卡片新增「用作参考图」按钮，点击跳转工作台并自动选中该参考图，无需重新上传。
- 新增批量清理未使用参考图功能，一键删除所有未被任何生成任务引用的参考图释放存储空间。
- 工作台支持 `refImageId` URL 参数，可直接引用已有参考图记录（`reference_images` 表），生成 API 通过 `existingRefId` 参数复用已有参考图文件。

## [0.3.17] - 2026-05-15

### 新增

- 设置页新增「参考图管理」模块，可查看所有用户上传的参考图列表，支持预览、查看文件信息（类型、大小、上传者、时间）和删除操作。
- 新增参考图列表与删除 API（`/api/reference-images`）及参考图文件服务 API（`/api/reference-images/[id]`），均限管理员访问。

## [0.3.16] - 2026-05-15

### 优化

- 全站 UI 升级为现代毛玻璃风格（Glassmorphism），面板、卡片、导航栏、设置项等核心元素统一使用 `backdrop-filter` + 半透明背景 + 柔和阴影。
- 新增完整的 CSS 设计 token 体系：圆角（`--radius-sm/md/lg`）、毛玻璃（`--glass-bg/border/blur`）、阴影层次（`--shadow-sm/md/lg/glow`）、过渡时间（`--transition-fast/base/slow/spring`）。
- 按钮升级为渐变背景，hover 微缩放 + 品牌色光晕，active 按下回弹效果。
- 输入框 focus 状态添加品牌色发光环和内阴影，增强交互反馈。
- 图片卡片、历史记录、队列项、设置页所有卡片元素统一添加 hover 浮起效果和边框高亮。
- 状态徽章添加毛玻璃效果，running 状态点增加脉冲动画。
- 主工作台三栏、设置页各区块、记录页卡片网格添加交错入场动画（fadeInUp）。
- 登录卡片和灯箱使用弹性缩放入场动画（scaleIn）。
- Toast 通知添加滑入滑出动画（slideInRight / slideOutRight），关闭时先播放退出动画再移除。
- 灯箱背景层添加模糊效果和淡入动画。
- Gallery 主题和 Dark 主题同步适配所有毛玻璃变量。Dark 主题移除全局 `box-shadow: none` 覆盖，改用暗色阴影和微妙的白色边框。
- 全局排版优化：正文添加负字距和抗锯齿渲染，面板标题和表单标签字重/字距微调。
- 移动端降低毛玻璃模糊度（12px）提升渲染性能，触控设备禁用 hover 浮起效果。
- 添加 `prefers-reduced-motion` 保护，尊重用户系统级减少动画偏好。

### 修复

- 修复灯箱（大图预览）被困在卡片内无法全屏弹出的问题。原因：父容器的 `backdrop-filter` 和入场动画 `transform` 会创建新的包含块，使 `position: fixed` 的灯箱相对于父容器定位而非视口。使用 React Portal 将灯箱渲染到 `document.body` 彻底解决，同时全站入场动画改为 `backwards` 避免残留 transform。

## [0.3.15] - 2026-05-15

### 优化

- 首页参考图上传后会立即显示“已选择上传参考图”、文件名和文件大小，避免无法判断是否选择成功。
- 参考图上传区域在选中文件后会变为确认态，并提供清除按钮。

## [0.3.14] - 2026-05-14

### 优化

- 缩略图生成从 `320px / WebP 76` 调整为 `640px / WebP 82`，在记录页、详情页和高分屏移动端取得更好的清晰度与体积平衡。
- 缩略图文件名加入版本标记，避免继续复用旧的低清缩略图。
- 缩略图 URL 新增 `tv=v2` 参数，用于让浏览器和 Cloudflare 重新获取新版缩略图。

## [0.3.13] - 2026-05-14

### 修复

- 修复移动端大图预览底部缩略图胶片栏被浏览器底部区域裁切、只显示一半的问题。
- 移动端大图预览高度优先使用动态视口 `100dvh`，并给底部安全区预留空间。

## [0.3.12] - 2026-05-14

### 修复

- 修复任务详情等页面缩略图从浏览器缓存命中时可能错过 `onLoad` 事件，导致骨架态不消失、缩略图看起来失效的问题。
- 缩略图加载失败时也会退出骨架态，避免页面长期显示空白占位。

## [0.3.11] - 2026-05-14

### 调整

- 多张图片生成改为拆分成多个独立后台任务，例如选择 3 张时创建 3 个 `1 张`任务，不再在同一个任务里连续请求 3 次模型。

### 优化

- 批量生成时首页结果预览会汇总多个单图任务的图片，并显示批量总进度。
- 最近记录和任务队列会显示拆分后的独立任务，单张失败、取消、重排和详情查看更清晰。
- 新一轮生成开始时会清空上一轮预览，避免任务创建阶段残留旧结果。
- 队列容量和每日生成上限按拆分后的单图任务数量计算，避免一次提交多图绕过限制。

## [0.3.10] - 2026-05-14

### 优化

- 首页生成表单改为更紧凑的参数面板，提示词、模型、尺寸、数量、参考图和提交区分区更清晰。
- 参考图上传改为可点击上传区域，历史参考图提示和清除操作保持在同一区域。
- 任务状态标签改为更克制的状态点样式，成功、失败、运行、排队和取消状态更轻量。
- 画廊主题下图片卡片默认减少文字干扰，鼠标悬停或键盘聚焦时显示操作按钮；触屏设备保持按钮常显。
- 版本链卡片统一缩略图、提示词、元信息和按钮区布局，修图链路更整齐。

## [0.3.9] - 2026-05-14

### 新增

- 大图预览新增底部缩略图胶片栏，多图任务可以直接点击缩略图切换到指定图片。

### 优化

- 大图预览在多图时会自动把当前缩略图滚动到可见区域。
- 空状态增加统一留白和文字宽度限制，移动端展示更稳。
- 记录页筛选按钮在窄屏下自动换行并保持等宽，设置页分组导航在小屏下改为两列。

## [0.3.8] - 2026-05-14

### 新增

- 记录页新增筛选栏，支持按关键词、状态、模型、尺寸、时间范围筛选，管理员额外支持按用户名筛选。
- 图片缩略图新增骨架加载态，记录页、首页最近记录、结果预览和详情页缩略图加载时更平滑。

### 优化

- 记录页筛选会同步影响总数、分页、上一页/下一页和页码跳转。
- 设置页改为分组导航布局，系统状态、Key 管理、用户管理、提示词模板和存储维护分区更清晰。
- 记录列表页的图片预览统一为 1:1 方形显示，横图和竖图在卡片中保持一致的预览尺寸。
- 无图片记录也使用同尺寸方形占位，避免记录卡片高度不齐。

## [0.3.7] - 2026-05-13

### 优化

- 首页最近记录里的“复制”按钮移动到任务状态后方，和 `succeeded` 等状态同排显示。
- 首页最近记录提示词改为两行截断，避免长提示词撑高卡片。

## [0.3.6] - 2026-05-13

### 优化

- 记录页卡片的“复制”按钮移动到“模型 · 用户”同一行最右侧。
- 记录页卡片底部按钮区保留重做、编辑、详情、删除等主要操作，布局更整齐。

## [0.3.5] - 2026-05-13

### 优化

- 记录页生成图片卡片统一为“图片、信息、底部按钮”三段布局，按钮固定在卡片底部。
- 记录页长提示词改为两行截断展示，完整提示词可通过底部复制按钮复制。
- 首页结果预览和任务详情里的图片卡片按钮也统一放在底部按钮区。

## [0.3.4] - 2026-05-13

### 优化

- 图片画廊主题下，首页“最近记录”移动到页面底部并横向自适应排列，结果预览区域更突出。

## [0.3.3] - 2026-05-13

### 优化

- 记录页每页显示数量从 10 条调整为 12 条，让多列图片卡片在页尾更容易对齐。

## [0.3.2] - 2026-05-13

### 新增

- 顶部菜单新增“界面主题”选择器，普通用户可直接在首页和各业务页面切换主题。
- 新增“自动”主题模式，按北京时间 7:00-18:59 使用浅色专业工作台，夜间自动切到深色创作台。
- 主题选择保存到当前浏览器的本地存储和 Cookie，不需要管理员权限。

### 优化

- 设置页移除管理员全局主题卡片，避免多人使用时互相覆盖界面偏好。
- 页面首屏会读取浏览器主题 Cookie，手动切换后当前页面立即生效，后续导航保持同一偏好。

## [0.3.1] - 2026-05-13

### 新增

- 新增界面主题系统，主题配置保存到 `app_settings`，对所有用户全局生效。
- 设置页新增“界面主题”卡片，可在“专业工作台”“图片画廊”“深色创作台”之间切换。
- 新增 `/api/settings/ui-theme` 管理接口，仅管理员可修改主题。

### 优化

- 首页、记录页、详情页、缓存说明、更新日志、登录页和设置页都会读取当前主题。
- CSS 改为主题变量驱动，面板、输入框、卡片、状态色、顶部栏和图片背景会随主题切换。
- 图片画廊主题放大预览和历史缩略图；深色创作台主题优化夜间使用观感。

## [0.2.3] - 2026-05-12

### 优化

- 顶部导航在宽度不足时会自动收起文字，只保留图标按钮。
- 窄屏下进一步收起品牌文字和版本号，避免顶部栏换行或占用过多高度。
- 导航图标按钮补充 `aria-label` 和 `title`，收起文字后仍可通过悬停或辅助技术识别功能。

## [0.2.2] - 2026-05-12

### 新增

- 应用默认时区固定为 `Asia/Shanghai`（UTC+8）。
- Docker 运行环境新增 `TZ=Asia/Shanghai` 和 `APP_TIME_ZONE=Asia/Shanghai`。
- 设置页“运行设置”显示当前应用时区。

### 修复

- PostgreSQL 连接创建时会设置数据库会话时区，确保 `now()`、`current_date`、每日生成上限等按 UTC+8 计算。
- 关键页面的时间显示统一使用 UTC+8 格式化，避免浏览器或容器默认时区不同导致显示偏差。

## [0.2.1] - 2026-05-12

### 新增

- AI Key 失败自动停用策略改为可配置。
- 设置页的“AI Key 轮询”卡片新增自动停用开关，可选择是否在连续失败后自动停用 Key。
- 设置页新增连续失败次数配置，支持 1-20 次，默认沿用原来的连续 3 次失败自动停用。

### 优化

- 老版本 Key 池配置会自动按默认策略迁移，不需要手动改数据库。
- 关闭自动停用后仍会记录 Key 的失败次数、连续失败次数和最近失败时间，方便手动判断 Key 健康状态。

## [0.1.30] - 2026-05-12

### 修复

- 后台队列启动时优先恢复服务重启遗留的 `running` 任务，避免重启后旧任务直接被超时兜底判失败。
- 运行中任务超时判断改为基于最近进度更新时间，避免多张图片生成时因整单耗时超过 5 分钟被误判失败。
- 队列 watchdog 标记任务超时后会同步释放本地运行计数，避免内存计数卡住导致后续任务无法认领。
- 记录详情接口改为纯读取，不再由生成中轮询反复触发后台队列。
- 运行中或排队中的任务禁止直接删除，需要先取消后再删除，减少 worker 保存图片时的竞态。

### 优化

- 新增 `MAX_GENERATION_QUEUE_SIZE` 配置，默认允许 20 个排队任务；生成并发和排队容量分开控制。
- Provider 请求遇到网络错误、429、5xx 或 Key 鉴权问题时，会记录当前 Key 失败并换下一个可用 Key 重试。
- 前端任务轮询增加中止控制，新任务开始、页面卸载或重复刷新时会取消旧请求；页面隐藏时减少静默队列/通知轮询。
- 失败任务图片清理改为先删除本地文件，成功后再删除数据库图片行，降低孤儿文件概率。

## [0.1.29] - 2026-05-11

### 修复

- 将通知轮询使用的 `/api/recent-jobs` 改为纯只读接口，不再由右上角通知轮询反复触发后台队列。
- 将 `/api/health` 改为纯健康检查，不再由 Docker healthcheck 触发生成队列。
- 重写运行中任务超时兜底 SQL，使用 CTE 显式声明参数类型，避免 PostgreSQL 参数推断失败导致队列无法认领任务。
- 队列认领任务时同步写入 `runId` 和 10% 进度，避免任务进入 `running` 后仍停留在 5% 且缺少可诊断状态。
- 后台 worker 在读取任务参数前失败时会立即落库真实错误，不再只依赖 5 分钟超时兜底。
- Docker 运行环境补充 `HOSTNAME=0.0.0.0`，确保 standalone server 在容器内明确监听所有地址。

## [0.1.28] - 2026-05-11

### 修复

- 修复队列超时兜底 SQL 参数类型推断失败的问题。
- 解决 `Generation queue drain failed: could not determine data type of parameter $2` 导致后台队列无法认领任务、生成进度一直停在 5% 的问题。

## [0.1.27] - 2026-05-11

### 修复

- 修复图片生成任务超过 5 分钟仍不自动失败的问题。
- `gpt-image-2` 的 URL 返回、Base64 回退和临时网络重试现在共享同一个 5 分钟截止时间，避免多轮重试把等待时间放大到 30 分钟以上。
- 队列增加运行中任务超时兜底，超过限制的 `running` 任务会自动落库为失败，不再只能手动取消。
- 生成图片 URL 下载也增加超时保护，避免模型已返回但下载阶段卡住。

### 配置

- 新增 `GENERATION_TIMEOUT_MS` 配置项，默认 `300000`，即 5 分钟。

## [0.1.26] - 2026-05-11

### 新增

- 增加全局站内任务通知中心，后台任务完成、失败或取消时会在右上角显示提示。
- 首页当前生成任务完成时会立即触发通知。
- 登录后的页面会轻量轮询最近任务，识别本浏览器见过的后台任务状态变化并提示。

## [0.1.25] - 2026-05-11

### 新增

- 设置页新增“存储维护”卡片，可扫描本地图片、参考图和缩略图状态。
- 新增孤儿文件扫描与清理能力，可识别数据库无记录但本地仍存在的图片文件。
- 新增重新生成缩略图功能。
- 新增批量清理失败任务图片功能，失败任务记录会保留，已保存图片和缩略图会被清理。
- 新增 `/api/storage-maintenance` 管理接口，仅管理员可访问。

## [0.1.24] - 2026-05-11

### 新增

- 增加任务控制接口 `/api/records/[id]/control`，支持取消任务和重新排队。
- 首页任务队列、最近记录、记录列表和任务详情页增加“取消”“重试”按钮。
- 失败或已取消任务可手动重试，重试时清理旧图片并重新加入后台队列。

### 优化

- 后台 worker 会在保存图片前校验当前运行批次，避免取消后旧模型返回串入重试任务。
- 取消排队任务后，队列会继续认领后续任务，减少队列短暂停顿。

## [0.1.23] - 2026-05-11

### 新增

- 新增 `/changelog` 页面，登录后可在网页内查看 `CHANGELOG.md` 更新日志。
- 顶部导航增加“日志”入口。

### 优化

- 首页任务队列移动到结果预览下方，右侧栏只保留最近记录。
- 调整首页队列卡片对齐方式和操作按钮尺寸。

## [0.1.22] - 2026-05-11

### 新增

- 增加图片版本链能力：使用历史图片作为参考图生成的新图片会记录父图关系。
- 任务详情页增加“图片对比 / 版本链”区域，可查看原图到修改版的链路，并支持放大、编辑、下载和跳转详情。
- `generated_images` 增加 `parent_image_id` 字段和索引，用于追踪修图链路。

## [0.1.21] - 2026-05-11

### 新增

- 增加提示词模板功能，管理员可在设置页新增、编辑、删除模板。
- 首页生成表单增加模板选择，可将模板内容填入或追加到当前提示词。
- 新增 `/api/prompt-templates` 接口和 `prompt_templates` 数据表。

## [0.1.20] - 2026-05-10

### 新增

- 首页右侧最近记录上方新增“任务队列”面板，显示运行中数量、排队数量、并发上限和活跃任务进度。
- 新增 `/api/queue` 队列状态接口，前端会定时刷新活跃任务列表。

## [0.1.19] - 2026-05-10

### 新增

- 生成流程改为数据库驱动的后台任务队列，接口创建任务后立即返回，后台 worker 按并发配置继续处理。
- 后台队列支持从数据库恢复排队任务，并会把长时间中断的运行中任务恢复为排队状态。
- 生成任务增加开始时间、完成时间和耗时统计字段。
- 任务详情页在提示词下方标签区域显示生成耗时。

## [0.1.18] - 2026-05-10

### 优化

- “重做”按钮改为只回填原任务参数，不再自动开始生成。
- 移除首页最近记录里的“复用”按钮，减少重复操作入口。
- 在提示词显示区域增加复制按钮，支持复制本次任务提示词。

## [0.1.17] - 2026-05-09

### 优化

- 删除大图预览顶部工具栏里的“重置”按钮，减少顶部占用空间。
- 收紧大图预览顶部工具栏间距，并禁止按钮换行，下载和关闭按钮保持在顶部同一行。

## [0.1.16] - 2026-05-09

### 新增

- 新增项目级 `CHANGELOG.md`，集中记录历史版本和后续更新内容。
- 在 `README.md` 中增加更新日志入口。

## [0.1.15] - 2026-05-09

### 修复

- 修复大图预览边缘出现浅色块的问题：缩略图样式不再误作用到弹层大图。
- 修复大图预览中鼠标点击上一张/下一张无效的问题：左右翻页按钮不再被父级拖拽层捕获指针事件。

## [0.1.14] - 2026-05-09

### 新增

- 大图预览支持相邻图片切换。
- 支持键盘 `ArrowLeft` / `ArrowRight` 翻页。
- 首页结果预览、记录列表页、任务详情页均接入图片组预览。

## [0.1.13] - 2026-05-09

### 优化

- 大图预览外层、舞台、画布和图片本身全部显式设为透明背景。
- 避免透明 PNG/WebP 在预览层被容器背景覆盖。

## [0.1.12] - 2026-05-09

### 优化

- 首页右侧最近记录的小图点击后跳转到任务详情页。
- 大图预览中的图片背景改为透明。

## [0.1.11] - 2026-05-09

### 优化

- 重构大图预览缩放方式，改为 `translate3d + scale` 的固定舞台缩放模型。
- 优化手指双指缩放、鼠标滚轮缩放、拖拽边界和缩放重置体验。
- 修复缩小后图片靠下、上方留白、底部无法拖到的问题。

## [0.1.10] - 2026-05-09

### 新增

- 增加用户安全管理能力。
- 密码改为服务端加盐哈希存储，不再明文保存。
- 增加登录失败锁定保护。
- 增加用户启用/停用、角色管理、重置密码和每日生成上限。

## 历史整理：0.1.0 - 0.1.9

### 初始能力

- 创建独立网页版 AI 图片生成工作台，适合 3-5 人部署使用。
- 支持通过可配置 Provider Base URL 调用 `gpt-image-2` 和 `Nano Banana 2`。
- 支持账号登录、生成记录、任务详情和图片本地保存。
- 使用 PostgreSQL 保存用户、任务、图片和参考图记录。
- 支持 1Panel 部署，本地构建 Docker 镜像，默认 Web 端口调整为 `3100`。

### 图片生成与记录

- 支持常用尺寸预设：`auto`、`1:1`、`9:16`、`16:9`、`4:3`、`3:4`。
- 尺寸预设以短边 `1024` 为基础，并满足模型对像素整除的要求。
- 增加 5 分钟生成超时处理。
- 支持并发生成、单任务多图保存、缩略图生成和原图下载。
- 记录页支持每页 10 条分页、页码选择和删除记录，同时删除本地图片。
- 首页右侧最近记录支持加载、刷新、复用提示词、重新生成和编辑参考图。

### 参考图与编辑

- 支持上传参考图生成/修图。
- 已生成图片可一键作为参考图继续编辑。
- 针对 `gpt-image-2` 修图接口路径做了适配。

### 缓存与性能

- 图片列表优先加载缩略图，点击大图时再加载原图，降低首页回流流量。
- 移除页面输出中的 provider 原始图片数据，避免 RSC/HTML 响应体异常变大。
- 增加 Cloudflare 缓存规则说明页，便于手动配置图片缓存。

### Key 与健康状态

- 支持多 API Key 轮询，每次生图切换 Key。
- 设置页可添加和管理 API Key。
- 增加 Key 健康管理和失败状态记录。
- 增加 `/api/health` 健康检查，包含数据库、存储、版本、provider base url、Key 数量和最近错误。
- 设置页增加系统状态卡片，可视化显示健康检查结果。

### 生成可靠性

- 支持任务失败重试。
- 单张图片失败后可自动重试，并在 Key 失败时切换下一个 Key。
- 超过 5 分钟未返回时落库为失败。

### 交互体验

- 大图预览支持点击图片外区域关闭。
- 支持鼠标滚轮缩放、按钮缩放、拖拽查看、手指双指缩放。
- 生成中进度条增加流动动画，显示当前请求、保存数量和进度百分比。
- 增加应用版本号显示。
