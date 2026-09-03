# 老板留言箱

面向抖音直播观众的移动优先留言应用。V1 只包含两件事：提交留言，以及使用手机号和抖音昵称查询自己的留言。前端与 API 由同一个 Cloudflare Worker 提供，结构化数据进入 D1，处理后的图片进入私有 R2。

## 已实现的产品边界

- 主表单严格按“主题 → 内容 → 图片 → 抖音昵称 → 手机号 → 两项确认 → 提交”排列，其他主题按需展开。
- 图片最多 3 张，每张严格小于 2 MiB；浏览器先离线压缩并移除元数据，Worker 再通过 Cloudflare Images 做真实解码、尺寸校验和 WebP 重编码。
- 验证码固定 6 位、5 分钟有效，手机号级 120 秒冷却由 D1 判定，刷新页面、发送成功或提交成功都不能绕过。
- 手机号使用带密钥 HMAC 查询，另以 AES-GCM 可逆加密保存；D1 不保存明文手机号。
- 一个手机号只绑定一个抖音昵称。查询接口对手机号不存在、昵称错误和没有记录返回同一种公开结果。
- 文本和确认项保存到 `localStorage`，图片草稿保存到 IndexedDB；只有服务端确认提交成功才会清空。
- D1 写入使用原子批处理。R2 与 D1 的跨服务失败由持久化清理队列补偿，每 15 分钟先确认对象未被留言引用，再安全删除。

核心业务依赖端口定义在 `worker/core/ports.ts`。D1、R2、Cloudflare Images、Turnstile 与阿里云号码认证服务 PNVS 只是当前适配器，未来替换数据库、对象存储或短信商时不需要重写表单和业务规则。

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

开发环境使用 Cloudflare 官方 Turnstile 测试密钥和固定验证码 `123456`。这个固定值只有 `APP_ENV=development` 时才会注入；即使生产环境误配了 `DEV_OTP_CODE`，代码也会忽略它，且 `mock` Provider 在 `production` 会被直接拒绝。

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

配置文件已声明这些 binding 和每 15 分钟执行一次的图片补偿任务。第一次部署前应用远程迁移：

```bash
pnpm exec wrangler login
pnpm run db:migrate:remote
```

迁移命令以 binding 名 `BOSS_MESSAGE_DB` 为目标；不要把 `--remote` 漏掉，也不要在尚未备份生产数据时改写已经执行过的迁移文件。

### 2. 配置 Turnstile 和非敏感变量

创建 Turnstile widget，把站点密钥写到 `wrangler.jsonc` 的 `TURNSTILE_SITE_KEY`。在 Turnstile 的 Hostname Management 中加入正式自定义域名；如果也准备直接使用稳定的 `*.workers.dev` 地址，再把它一并加入。将完全相同的 hostname 列表按逗号分隔写入 `TURNSTILE_EXPECTED_HOSTNAMES`，不带协议、端口和路径。非生产版本的临时预览域名默认不加入白名单，这样它们不会误写正式留言数据。同步确认：

- `APP_ENV=production`
- `SMS_PROVIDER=alibaba_pnvs`
- `PRIVACY_POLICY_VERSION` 与正式隐私政策的版本/生效日期一致
- `LIVESTREAM_POLICY_VERSION` 与正式直播展示说明一致

Turnstile secret 不要写进 Git，它属于下一步的运行时 Secret。

### 3. 配置运行时 Secrets

进入 Worker → Settings → Variables & Secrets，把下面所有项目设为 **Secret**，不要设成普通明文变量：

- `TURNSTILE_SECRET_KEY`
- `PHONE_HASH_KEY`
- `PHONE_ENCRYPTION_KEY`
- `OTP_HMAC_KEY`
- `RATE_LIMIT_HMAC_KEY`
- `ALIBABA_ACCESS_KEY_ID`
- `ALIBABA_ACCESS_KEY_SECRET`
- `ALIBABA_PNVS_SIGN_NAME`
- `ALIBABA_PNVS_TEMPLATE_CODE`

前五个安全密钥都应分别使用 `openssl rand -base64 32` 生成，不能复用。请离线备份 `PHONE_HASH_KEY` 与 `PHONE_ENCRYPTION_KEY`：前者决定历史记录能否继续按手机号命中，后者决定手机号能否解密，不能像普通会话密钥那样随意替换。

后四项用于阿里云号码认证服务 PNVS 的短信认证，不是普通短信服务 SMS：AccessKey 可以沿用同一套通用凭据名，但签名与模板必须从号码认证控制台的“短信认证参数配置”中取得。当前 PNVS 不支持普通 SMS 的自定义签名/模板，建议使用系统赠送签名，并与系统赠送模板配套；两套产品的模板资源和套餐也不互通。

生产发送流程保持为：Worker 每次用 Web Crypto 安全随机生成新的 6 位数字 → 以现有 `OTP_HMAC_KEY` 做 HMAC 并保存在 D1 状态中 → 将这个具体数字放入 `SendSmsVerifyCode.TemplateParam` 的 `code` 字段 → PNVS 只负责发送 → 用户回填后仍由本 Worker 和 D1 校验。实现不会传入 `##code##`，不会传 `CodeType`，也不会调用 `CheckSmsVerifyCode`。PNVS 请求同时固定 `CountryCode=86`、`CodeLength=6`、`ValidTime=300`、`Interval=120`、`ReturnVerifyCode=false` 和 `AutoRetry=0`；模板须包含 `${code}` 与 `${min}` 两个变量，`min` 会传入 `5`。按照该 Operation 的官方 SDK metadata，这些业务参数全部位于 URL query，POST 请求体为空；ACS3 签名也使用排序编码后的 query 和空请求体 SHA-256。

建议为 RAM 用户配置只允许 `dypns:SendSmsVerifyCode` 的最小权限。上线前还要在号码认证服务中开通短信认证、确认账户余额或购买 PNVS 短信认证套餐，并用控制台显示的签名名称和模板 Code 填入上述两个 Secret。

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

如果你把整个 NRadio 目录作为仓库，Root directory 改为 `/Github/boss-message-box`。Cloudflare 会使用仓库 `package.json` 中安装的 Wrangler 版本，`.nvmrc` 固定 Node 24；设置 `PNPM_VERSION` 可让云端与本地使用完全相同的 pnpm。推送到 `main` 后会先执行全部自动检查，再构建并发布，其他分支只上传预览版本。Build variables 只在构建期可见，不能替代 Worker 的运行时 Secrets。

首次部署成功后，在 Worker 的 Settings → Domains & Routes 中添加正式自定义域名，并确认它与 Turnstile 和 `TURNSTILE_EXPECTED_HOSTNAMES` 中填写的 hostname 完全一致。Worker 名称必须保持为 `boss-message-box`，否则 Git 连接会因为与 `wrangler.jsonc` 的 `name` 不一致而失败。

### 5. 上线前必须完成的人工检查

- 用号码认证服务 PNVS 的真实赠送签名和配套模板发送一次验证码，确认收到的数字正是 Worker 本次生成的 OTP，并检查模板参数、120 秒频控、PNVS 套餐余额和账单告警。
- 在真实 iPhone/Android、微信/抖音内置浏览器，以及移动/联通/电信网络各测试一次：打开、Turnstile、收码、提交、刷新后冷却、历史查询和三张大图。
- 确认 R2 的 Public Development URL 显示为未允许，并从公网直接请求随机对象 key 应失败。
- 在 Cloudflare Observability 中确认错误日志只有 request ID、错误码和供应商 request ID，没有手机号、验证码、留言正文或图片 URL。
- 请法务或负责个人信息保护的人审核隐私政策、直播公开展示说明、保存期限、境外处理与联系方式；当前页面提供的是产品实现文本，不替代正式法律审查。

> **大陆可用性风险：** Cloudflare 官方文档明确写明 Turnstile 不支持中国大陆，而本产品的目标用户正是大陆抖音观众。代码仍按需求实现了完整的 Turnstile 服务端校验，但在完成真实大陆设备测试前不要直接公开上线。如果 widget 在目标网络无法稳定加载，需要先确定一个大陆可访问的替代人机验证服务，再分别替换前端 `TurnstileWidget` 和后端 `TurnstileVerifier` 适配器；D1 冷却、IP/手机号频控和短信验证码逻辑可以原样保留。

## 目录说明

- `src/`：React 用户界面、草稿、图片压缩与共享校验契约
- `worker/`：Hono API、领域服务、Cloudflare/阿里云适配器
- `migrations/`：可维护的 D1 SQL 迁移
- `tests/unit/`：契约、加密、草稿、表单、短信异常和图片补偿测试
- `tests/worker/`：真实 workerd + D1 的迁移和仓库集成测试
- `DESIGN_SYSTEM.md`：后续页面必须遵循的视觉与交互规范
