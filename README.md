# 张导请回答

一个用于收集、整理和处理观众留言的 Web 应用。项目包含面向观众的提交与查询页面，以及供内部人员使用的 Studio 工作台。

## 开发环境

项目使用 Node.js、pnpm 和 Cloudflare Workers。建议使用仓库 `.nvmrc` 指定的 Node.js 版本。

```bash
nvm use
corepack enable
pnpm install --frozen-lockfile
cp .dev.vars.example .dev.vars
pnpm run db:migrate:local
pnpm dev
```

本地配置请从 `.dev.vars.example` 开始，并为需要的密钥填写仅用于开发的值。`.dev.vars` 和任何真实凭据都不应提交到 Git。

## 常用命令

```bash
pnpm dev                 # 启动本地开发服务器
pnpm run typecheck       # TypeScript 检查
pnpm run lint            # 代码规范检查
pnpm test                # 运行测试
pnpm run check           # 执行完整检查与生产构建
pnpm run check:visual    # 执行响应式界面检查
pnpm run db:migrate:local
pnpm run db:migrate:remote
pnpm run deploy
```

在应用远程数据库迁移前，请先备份数据并审阅尚未应用的迁移文件。生产环境变量和 Secrets 应通过 Cloudflare 配置，不要写入源码。

## 项目结构

```text
src/                  前端应用
worker/               Worker API 与服务端逻辑
migrations/           D1 数据库迁移
tests/unit/            单元测试
tests/worker/          Worker 与 D1 集成测试
scripts/               项目检查脚本
public/                静态资源
```

视觉与交互调整应遵循 `DESIGN_SYSTEM.md`。新增功能时请保持公开端与 Studio 的职责边界，并在提交前运行 `pnpm run check`。

## 部署

项目通过 Cloudflare Workers 运行，并使用 D1、R2、Images 等绑定。具体资源名称、绑定和非敏感运行变量以 `wrangler.jsonc` 为准；Secret 名称与本地开发占位项以 `.dev.vars.example` 为准。

部署前至少确认：

- 远程数据库已备份，待应用的迁移已经审阅；
- Cloudflare 资源与 `wrangler.jsonc` 中的绑定一致；
- 运行时 Secrets 已配置且未进入 Git；
- `pnpm run check` 完整通过。

随后按当前部署流程发布代码。管理员凭据、生产数据处理规则及其他内部运维信息不在 README 中维护。
