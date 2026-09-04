# 张导请回答

面向抖音直播观众的移动优先留言应用，并在同一 Worker 内提供仅供内部人员使用的 Studio 工作台。公开端负责提交和查询自己的留言；管理员手动访问 `/studio` 处理留言。结构化数据进入 D1，处理后的图片进入私有 R2。

## 已实现的产品边界

- 主表单严格按“主题 → 内容 → 抖音昵称 → 可选图片 → 两项确认 → 提交”排列。手机号和短信验证码已从当前提交、查询流程移除，原实现只作为未来重新启用时的备用代码保留。
- 同一个经过 `trim + NFC` 规范化后的抖音昵称，按大小写精确区分，并按北京时间自然日最多成功提交 10 条；计数与留言在同一个 D1 原子批处理中写入。
- “我的留言”只要求抖音昵称，并返回该精确昵称下的全部留言。这个产品选择意味着知道相同昵称的人也能看到这些记录，不能把它当作身份认证。
- 图片最多 3 张，默认关闭并放在表单最后；用户主动开启后才显示上传控件。应用不设压缩后文件大小门槛，浏览器和 Worker 仍分别完成图片清理与 WebP 重编码。
- 文本和确认项保存到 `localStorage`，图片草稿保存到 IndexedDB；只有服务端确认提交成功才会清空。
- D1 写入使用原子批处理。R2 与 D1 的跨服务失败由持久化清理队列补偿，每 15 分钟先确认对象未被留言引用，再安全删除。
- 新留言保存成功后由 Worker 异步调用 OpenAI-compatible AI 接口。AI 只接收主题和正文；只有纯辱骂或无意义内容会被过滤，负面评价、投诉、售后问题和具体产品问题必须保留。供应商异常时 fail-open，留言照常进入未回复列表，Studio 显示“AI 筛选失败”。

核心业务依赖端口定义在 `worker/core/ports.ts`。D1、R2、Cloudflare Images、Turnstile 与 AI 服务都是适配器；当前表单业务层不依赖具体 AI 厂商，也不依赖旧短信 Provider。

## Studio 工作台

Studio 没有公开入口，管理员需要直接访问 `https://message.fallaxaura.com/studio`。它与公开端共用 Worker、D1 和 R2，但前端路由、API、会话和样式均独立隔离。工作台包含未回复、可折叠的已回复分组、AI 已过滤、待办、统一搜索、主题筛选、留言详情和直播展示模式。

固定账号为 `zd`、`mm`、`fa`、`ceshi`，四个账号权限完全相同，当前初始密码均为 `admin`。迁移只写入带独立随机盐的 PBKDF2-SHA256 哈希，不保存密码明文；登录 Cookie 为 30 天固定有效期的 `HttpOnly; Secure; SameSite=Strict` 会话，D1 只保存随机 token 的 SHA-256 摘要。`admin` 只是当前明确指定的初始密码，强度很低，不应把 Studio 暴露给不受信任人员；后续更换密码应通过新的 D1 migration 更新哈希，不要修改已经应用的迁移文件。

进入直播展示模式时，会话本身会切换成 `live`，服务端只允许未回复和待办上下文、拒绝搜索与人工筛选，并强制新增回复为直播回复。详情页右下角固定显示“下一条”：回复框非空时先保存直播回复再前进，留空时不创建回复直接前进。AI 已过滤留言不会进入待办或直播模式。R2 对象仍不公开，图片查看和下载都通过已认证的同源 Worker 接口完成。

`migrations/0004_nickname_submission_and_moderation.sql` 是一次有意的清库迁移：保留 `admins` 管理员账号，清除管理员会话及全部既有用户、手机号、OTP、留言、正文、回复、审计和计数数据，并把旧图片对象加入 R2 清理队列。它随后建立昵称日限额和 AI 筛选字段。应用远程迁移前仍应先备份，确认确实要删除旧业务数据。

## 本地运行

需要 Node.js 22.13 以上，推荐使用项目 `.nvmrc` 对应的 Node 24，并启用 Corepack。

```bash
nvm use
corepack enable
pnpm install --frozen-lockfile
cp .dev.vars.example .dev.vars
```

为 `.dev.vars` 中的四个本地密钥分别生成独立值：

```bash
openssl rand -base64 32
```

然后应用本地 D1 迁移并启动：

```bash
pnpm db:migrate:local
pnpm dev
```

开发环境使用 Cloudflare 官方 Turnstile 测试密钥。旧 OTP 测试配置仍留在 `.dev.vars.example`，但当前用户提交和历史查询不会调用它。Studio 账号不变，本地迁移完成后仍可使用上述四个账号和初始密码登录。

AI 筛选需要 `AI_BASE_URL`、`AI_MODEL` 和 `AI_API_KEY`。缺少或调用失败时不会拦截留言，只会在 Studio 标记为筛选失败。项目按 OpenAI-compatible `POST /chat/completions` 接口实现，通过强约束 prompt 要求严格 JSON，再由 Worker 做结构校验；没有强依赖兼容服务未必支持的 JSON Schema 参数。目标配置是 `https://api.deepseek.com` 与 `deepseek-v4-flash`。

完整验证命令是：

```bash
pnpm run check
```

它会依次执行类型检查、代码规范、单元与真实 Worker/D1 集成测试、配色对比度检查，以及生产构建。

需要复查响应式界面时，保持 `pnpm dev` 运行，再在另一个终端执行 `pnpm run check:visual`。该脚本使用本机 Chrome 检查 375×700、768×800、1280×800 三档视口、横向溢出和政策弹层关闭后的草稿保留，并把截图写入系统临时目录。

## 你接下来要做的 Cloudflare 配置

### 1. 创建资源并更新 Wrangler 配置

在同一个 Cloudflare 账号下创建：

1. 名为 `boss-message-box` 的 D1 数据库；把实际 `database_id` 写入 `wrangler.jsonc`。
2. 名为 `boss-message-box-images` 的 R2 bucket。不要启用 `r2.dev`，也不要绑定公开自定义域名。
3. Cloudflare Images。项目使用 `IMAGES` binding 做服务端真实解码和重编码，不是公开图片托管。
4. 名为 `boss-message-box` 的 Worker。Worker 名称应与 `wrangler.jsonc` 的 `name` 一致。

配置文件已声明这些 binding 和每 15 分钟执行一次的图片补偿、过期 Studio 会话清理任务。部署包含 Studio 的代码前，必须先备份 D1 并应用远程迁移：

```bash
pnpm exec wrangler login
pnpm run db:migrate:remote
```

迁移命令以 binding 名 `BOSS_MESSAGE_DB` 为目标；不要把 `--remote` 漏掉，也不要在尚未备份生产数据时执行。`0004_nickname_submission_and_moderation.sql` 会按本次明确要求永久清除现有用户业务数据，只保留管理员账号；完成后旧 R2 图片会进入清理队列，并在最多约 15 分钟后的定时任务中删除。

### 2. 配置 Turnstile 和非敏感变量

创建 Turnstile widget，把站点密钥写到 `wrangler.jsonc` 的 `TURNSTILE_SITE_KEY`。在 Turnstile 的 Hostname Management 中加入正式自定义域名；如果也准备直接使用稳定的 `*.workers.dev` 地址，再把它一并加入。将完全相同的 hostname 列表按逗号分隔写入 `TURNSTILE_EXPECTED_HOSTNAMES`，不带协议、端口和路径。非生产版本的临时预览域名默认不加入白名单，这样它们不会误写正式留言数据。同步确认：

- `APP_ENV=production`
- `PRIVACY_POLICY_VERSION` 与正式隐私政策的版本/生效日期一致
- `LIVESTREAM_POLICY_VERSION` 与正式直播展示说明一致
- `AI_BASE_URL=https://api.deepseek.com`
- `AI_MODEL=deepseek-v4-flash`

`AI_BASE_URL` 和 `AI_MODEL` 可以作为普通变量，正式上线前由你加入 `wrangler.jsonc` 现有的 `vars`；不要只在 Dashboard 里临时添加，因为下一次 Wrangler 部署会用配置文件覆盖普通变量。Turnstile 与 AI 的密钥不要写进 Git，它们属于下一步的运行时 Secret。

### 3. 配置运行时 Secrets

进入 Worker → Settings → Variables & Secrets，确认现有安全变量仍在，并新增 AI 密钥。当前公开提交链路直接需要：

- `TURNSTILE_SECRET_KEY`
- `RATE_LIMIT_HMAC_KEY`（Studio 登录限流仍在使用）
- `AI_API_KEY`

以下变量属于保留的旧手机号/OTP/PNVS 能力，当前用户提交和查询不会使用。不要为了本次上线重新生成或删除现有值；未来要重新开启短信验证时可继续使用：

- `PHONE_HASH_KEY`
- `PHONE_ENCRYPTION_KEY`
- `OTP_HMAC_KEY`
- `ALIBABA_ACCESS_KEY_ID`
- `ALIBABA_ACCESS_KEY_SECRET`
- `ALIBABA_PNVS_SIGN_NAME`
- `ALIBABA_PNVS_TEMPLATE_CODE`

AI 请求只发送留言主题和正文，不发送昵称、图片、管理员资料或旧手机号。实现使用 `Authorization: Bearer ...`，不会记录 API Key 或留言正文。建议给这把 Key 设置独立额度和账单告警。由于你选择暂不修改页面隐私政策，上线前仍应自行确认把留言正文发送给第三方 AI 服务是否符合你的告知义务。

### 4. 连接 GitHub，让 Cloudflare 自动部署

把本目录作为仓库根目录推到 GitHub 后，在 Cloudflare 的 Worker 中打开 Settings → Builds → Connect，授权 Cloudflare Workers & Pages GitHub App 并选择仓库。建议配置：

| 配置项 | 值 |
|---|---|
| Production branch | `main` |
| Root directory | `/`（如果本目录就是仓库根目录） |
| Build command | `pnpm run check` |
| Deploy command | `pnpm exec wrangler deploy` |
| Non-production deploy | `pnpm exec wrangler versions upload` |
| Node version | `.nvmrc` 已固定为 24 |
| Build variable（建议） | `PNPM_VERSION=11.22.0` |

如果你把整个 NRadio 目录作为仓库，Root directory 改为 `/Github/boss-message-box-v1`。Cloudflare 会使用仓库 `package.json` 中安装的 Wrangler 版本，`.nvmrc` 固定 Node 24；设置 `PNPM_VERSION` 可让云端与本地使用完全相同的 pnpm。推送到 `main` 后会先执行全部自动检查，再构建并发布，其他分支只上传预览版本。Build variables 只在构建期可见，不能替代 Worker 的运行时 Secrets。

首次部署成功后，在 Worker 的 Settings → Domains & Routes 中添加正式自定义域名，并确认它与 Turnstile 和 `TURNSTILE_EXPECTED_HOSTNAMES` 中填写的 hostname 完全一致。Worker 名称必须保持为 `boss-message-box`，否则 Git 连接会因为与 `wrangler.jsonc` 的 `name` 不一致而失败。

### 5. 上线前必须完成的人工检查

- 先配置 AI 三个变量，再用一条具体负面反馈、一条纯辱骂和一条无意义留言检查结果：具体投诉必须进入未回复；纯辱骂和无意义留言进入“AI 已过滤”；断开或故意填错 AI Key 时，留言仍应进入未回复并显示筛选失败。
- 在真实 iPhone/Android、微信/抖音内置浏览器各测试一次：打开、Turnstile、提交、昵称日限额、按昵称查询、图片开关、三张大图，以及直播模式有回复/无回复两种“下一条”。
- 确认 R2 的 Public Development URL 显示为未允许，并从公网直接请求随机对象 key 应失败。
- 在应用迁移后确认 D1 只保留四个 `admins` 账号，旧用户、留言、回复和昵称限额为空；再等一次定时任务执行，确认旧 R2 图片和 `image_cleanup_queue` 已清理。
- 在 Cloudflare Observability 中确认错误日志只有 request ID、错误类别和留言 ID，没有 AI Key、留言正文、昵称或图片 URL。
- 请法务或负责个人信息保护的人审核隐私政策、直播公开展示说明、保存期限、境外处理与联系方式；当前页面提供的是产品实现文本，不替代正式法律审查。

> **大陆可用性风险：** Cloudflare 官方文档明确写明 Turnstile 不支持中国大陆，而本产品的目标用户正是大陆抖音观众。代码仍按需求保留完整的 Turnstile 服务端校验，但在完成真实大陆设备测试前不要直接公开上线。如果 widget 在目标网络无法稳定加载，需要先确定一个大陆可访问的替代人机验证服务，再分别替换前端 `TurnstileWidget` 和后端 `TurnstileVerifier` 适配器；昵称日限额逻辑可以原样保留。

## 目录说明

- `src/`：React 用户界面、草稿、图片压缩与共享校验契约
- `src/features/studio/`：独立的 Studio 路由、会话、工作台页面和作用域样式
- `worker/`：Hono API、领域服务、Studio 安全边界及 Cloudflare/AI 适配器
- `migrations/`：可维护的 D1 SQL 迁移
- `tests/unit/`：契约、草稿、表单、AI fail-open、保留的短信实现和图片补偿测试
- `tests/worker/`：真实 workerd + D1 的迁移和仓库集成测试
- `DESIGN_SYSTEM.md`：后续页面必须遵循的视觉与交互规范
