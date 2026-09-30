# 分流测试

[返回项目说明](../README.md)。`split-tunnel-lab` 已合并到本项目，前端源码位于 `src/features/iptest/`，归属地 API 位于 `worker/routes/iptest.ts`。首页表单和公司页脚之间提供「分流测试」入口；部署后地址为 `https://msg.zdwifi.com/iptest`。与留言板共用构建、导航、设计变量和 Cloudflare 部署，无需 Python 服务或第二个站点。

- 浏览器直接检测目标站点；不经 Worker 转发，避免测成服务器的出口。
- 「响应耗时」显示本次浏览器检测的毫秒数，不含排队和归属地查询，不另发测速请求。它不是 ICMP Ping，不代表链路 RTT；超时单独显示，失败请求不显示误导性的延迟数值。
- 支持站点分类、搜索、单项重测、停止检测和最多 30 个自定义站点，兼容旧版浏览器存储。
- 站点名称左侧显示随项目保存的 Logo，来源记录在 `public/site-icons/sources.json`。页面无需请求外部图标服务；缺失或加载失败时显示首字占位，自定义站点同样支持占位。
- IP 查询与网站响应分开显示。普通网站不再套用不存在的 Trace 接口；无法跨域读取不直接判定为断网，不显示底层 HTTP 错误码。
- 61 个 IP 节点自动检测（含 AI 工具、开发服务分类）：Cloudflare Trace、网易 / 字节响应头，以及腾讯 / 阿里 / Ping0 JSONP。24 个仅支持网站响应的项目单独展示。节点只代表所列域名，不代表供应商旗下所有产品。
- 浏览器先显示真实出口 IP，再经 `/api/iptest/geo?ip=…` 补充国家、城市和运营商。按 IP 合并请求；服务失败不会覆盖 IP。Worker 只查询指定 IP 的归属地，不代替浏览器检测出口。
- 站点返回的国家代码统一为大写，常见国家 / 地区名称会转换为国旗。归属地查询失败时，同轮检测中相同 IP 可共享一致的国家信息；冲突时保留各自结果，不推断城市或运营商，也不沿用上轮信息。未启用、限流和超时分别提示，未启用时需按下文配置生产供应商。
- JSONP 在无同源权限的 sandbox iframe 中运行；校验消息来源和随机令牌。`/iptest-probe.html` 与 Cloudflare 的规范路径 `/iptest-probe` 均配置独立 CSP。
- `/iptest` 和 `/iptest/` 单独允许 HTTPS 检测请求；入口和返回使用整页导航，确保分别加载对应 CSP。此规则遵循 [Cloudflare 静态资源响应头配置](https://developers.cloudflare.com/workers/static-assets/headers/)。

## 验证

先完成根目录 README 的本地配置和数据库迁移，再运行生产预览；浏览器检查需另开终端：

```sh
pnpm run build
pnpm preview --host 127.0.0.1 --port 5173
pnpm run check:visual:iptest
```

浏览器检查使用模拟站点响应，覆盖入口位置、生产 CSP、筛选、自定义站点和 320–1280px 布局；真实外站可用性取决于用户网络与目标跨域策略。它不会提交留言或修改远程数据。

## 归属地配置

- **本地体验：** `APP_ENV=development` 自动使用无密钥的 [IP.SB](https://ip.sb/api/)，IP.SB 免费方案用于个人与评估，商业使用需联系其授权。
- **正式环境：** 推荐 [IPinfo Core](https://ipinfo.io/developers/core-api)。在 IPinfo Dashboard 获取拥有 Core / 城市查询权限的 token，通过 `pnpm exec wrangler secret put IPINFO_TOKEN` 写入 Cloudflare；本地可写入被忽略的 `.dev.vars`。代码使用 `https://api.ipinfo.io/lookup/{ip}`，密钥仅在 Worker 的 Authorization 请求头中使用。Lite 只有国家和 ASN，不能提供同样的城市效果。
- 已有 IP.SB 商业授权时，可设置 Worker 变量 `IPTEST_GEO_PROVIDER=ipsb`。生产环境未配置供应商时，出口检测仍工作，归属地显示暂不可用；不会自动调用评估接口。
- 成功的归属地在边缘缓存 24 小时。未命中缓存的查询限每访客 40 次 / 分钟；IP.SB 全站 80 次 / 分钟且 4 次 / 秒，IPinfo 全站 4,000 次 / 日。限额位于 `worker/routes/iptest.ts`，更换套餐时相应调整。失败结果不缓存；重新检测会重试。不会向供应商发送留言内容或身份信息。

## 维护站点与图标

- `src/features/iptest/targets.ts`：站点与检测方式。新增 IP 节点前检查是否返回合法 IP、是否保持同一域名、是否允许浏览器跨域读取。没有 IP 接口的站点放入网站响应列表。
- `src/features/iptest/site-logos.ts`：站点 ID 到本地图标的映射；源文件和来源清单位于 `public/site-icons/`。缺失图标保留占位，不依赖在线 favicon 服务。
- `scripts/check-iptest.mjs`：模拟数据的浏览器回归检查；调整预设数量或分类时同步更新期望值，再用真实网络抽查。

旧 `split-tunnel-lab` 是独立 Git 仓库；其迁移说明和文件删除需要在该仓库单独提交。留言板构建不依赖旧目录。
