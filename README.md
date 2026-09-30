# 张导请回答

留言收集与处理应用，包含公开留言页面、内部 Studio 工作台，以及合并后的分流测试 `/iptest`。使用 React、Vite、Cloudflare Workers、D1、R2 和 Images，统一构建与部署。

## 本地开发

使用 `.nvmrc` 指定的 Node.js 24 和 `package.json` 指定的 pnpm 版本。在本目录运行：

```sh
nvm use
corepack enable
pnpm install --frozen-lockfile
cp .dev.vars.example .dev.vars
pnpm run db:migrate:local
pnpm dev
```

已有 `.dev.vars` 时保留现有配置，不要重复覆盖。该文件和真实凭据均已忽略，不应提交。

- `/`：提交留言；`/my`：查看自己的留言。
- `/studio`：内部工作台。首次使用前，在另一个交互终端设置管理员密码：`pnpm run admin:password --username zd --local`。
- `/iptest`：浏览器分流检测，显示站点 Logo、出口 IP、归属地与响应耗时；本地使用 IP.SB，无需 API Key。

新增管理员使用 `pnpm run admin:create --username <账号> --local`。管理员命令隐藏密码输入；管理线上账号时明确改用 `--remote`。

## 提交前检查

```sh
pnpm run check           # 类型、Lint、单元测试、Worker 测试、对比度与生产构建
pnpm preview --host 127.0.0.1 --port 5173
```

保持生产预览运行，在另一个终端执行：

```sh
pnpm run check:visual:iptest   # 分流测试、首页入口、CSP、筛选和响应式布局
```

其他常用命令：

| 命令 | 用途 |
|---|---|
| `pnpm dev` | 本地开发与热更新 |
| `pnpm test` | 单元与 Worker 集成测试 |
| `pnpm run build` | 类型检查与生产构建 |
| `pnpm run check:visual` | 公开页面的界面检查 |
| `pnpm run check:visual:live` | Studio 分流、导入与直播检查 |
| `pnpm run check:visual:responsive` | 直播正文尺寸与文字缩放 |
| `pnpm run check:visual:order` | 直播顺序检查 |
| `pnpm run check:visual:reply` | 历史回复删除检查 |

界面脚本通常使用模拟数据，不代表外部站点实时可用。截图输出到已忽略的 `test-results/`。

若使用 Node.js 26 且遇到测试环境的 `localStorage` 冲突，优先切回 Node.js 24，也可临时运行 `NODE_OPTIONS=--no-experimental-webstorage pnpm run check`。

## 部署

资源绑定与非敏感变量见 `wrangler.jsonc`，本地配置模板见 `.dev.vars.example`。生产 Secret 通过 Cloudflare 配置。

1. 备份远程数据库，并审阅尚未应用的迁移。
2. 确认 D1、R2、Images、运行变量和 Secret 均已配置。
3. 运行 `pnpm run check` 及受影响页面的界面检查。
4. 执行 `pnpm run db:migrate:remote`，随后执行 `pnpm run deploy`。

不要重放已执行的历史迁移；`0004` 包含历史数据重置操作。各项 Studio 功能对应的迁移见[业务与运维说明](docs/studio.md)。

分流测试与留言板一起部署到 `/iptest`，无需 Python 或第二个服务。**生产归属地查询需要额外配置**：推荐用 `pnpm exec wrangler secret put IPINFO_TOKEN` 设置具有城市查询权限的 IPinfo Core Token；已有 IP.SB 商业授权时可配置 `IPTEST_GEO_PROVIDER=ipsb`。未配置时出口 IP 与响应耗时仍可检测，归属地不可用。详见[分流测试说明](docs/iptest.md)。

## 代码与文档

```text
src/                     前端应用
  features/iptest/        分流测试页面、节点与浏览器检测
  shared/                前后端共享类型与解析
worker/                  API、业务逻辑、存储与定时维护
migrations/              D1 增量迁移
tests/unit/              单元测试
tests/worker/            Worker 与 D1 集成测试
scripts/                 开发、管理与界面检查脚本
public/                  静态资源、站点图标与 CSP
docs/                    功能与运维说明
```

- [分流测试](docs/iptest.md)：检测方式、数据来源、供应商配置与站点维护。
- [Studio 业务与运维](docs/studio.md)：留言处理、导出、Excel 导入、分流和直播批次。
- [设计规范](DESIGN_SYSTEM.md)：共用色板、组件、布局和交互。

`split-tunnel-lab` 的旧入口仅保留迁移指引与启动脚本。本项目已包含全部运行代码，不需要旧目录。
