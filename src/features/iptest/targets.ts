import type { Kind, Target } from "./probe";

function trace(id: string, name: string, domain: string, kind: Kind): Target {
  return { id, name, domain, kind, method: "trace", path: "/cdn-cgi/trace" };
}

function site(id: string, name: string, domain: string, kind: Kind, path = "/"): Target {
  return { id, name, domain, kind, method: "site", path };
}

// Trace additions checked for valid IPs, same-host responses and browser CORS on 2026-09-30.
// Provider policies may change; never substitute another host's IP when a probe fails.
export const presets: Target[] = [

  // IP lookup services
  { id: "ipify", name: "ipify IPv4", domain: "api.ipify.org", kind: "probe", method: "echo", path: "/?format=json" },
  { id: "ipify6", name: "ipify IPv4 / IPv6", domain: "api64.ipify.org", kind: "probe", method: "echo", path: "/?format=json" },
  { id: "ipinfo", name: "IPinfo", domain: "ipinfo.io", kind: "probe", method: "echo", path: "/json" },
  { id: "ping0", name: "Ping0", domain: "ping0.cc", kind: "probe", method: "ping0", path: "/geo" },
  { id: "icanhazip", name: "icanhazip", domain: "icanhazip.com", kind: "probe", method: "echo", path: "/" },
  { id: "aws", name: "Amazon Check IP", domain: "checkip.amazonaws.com", kind: "probe", method: "echo", path: "/" },

  // Domestic services
  { id: "alibaba", name: "阿里云 · 检测节点", domain: "dns-detect.alicdn.com", kind: "domestic", method: "alibaba", path: "/" },
  { id: "netease", name: "网易 · CDN", domain: "necaptcha.nosdn.127.net", kind: "domestic", method: "headers", path: "/ab7f4275c1744aa28e0a8f3a1c58c532.png" },
  { id: "tencent", name: "腾讯 · 新闻节点", domain: "r.inews.qq.com", kind: "domestic", method: "tencent", path: "/api/ip2city" },
  trace("qualcomm", "Qualcomm 中国", "www.qualcomm.cn", "domestic"),
  { id: "byte-0", name: "字节跳动 · 国内", domain: "perfops.byte-test.com", kind: "domestic", method: "headers", path: "/500b-bench.jpg" },
  site("baidu", "百度", "www.baidu.com", "domestic"),
  site("douyin", "抖音 · 官网", "www.douyin.com", "domestic"),
  site("bilibili", "哔哩哔哩", "www.bilibili.com", "domestic"),
  site("zhihu", "知乎", "www.zhihu.com", "domestic"),
  site("jd", "京东", "www.jd.com", "domestic"),
  site("taobao", "淘宝", "www.taobao.com", "domestic"),
  trace("v2ex", "V2EX", "www.v2ex.com", "domestic"),
  trace("linuxdo", "LINUX DO", "linux.do", "domestic"),

  // AI tools
  trace("chatgpt", "ChatGPT", "chatgpt.com", "ai"),
  trace("claude", "Claude", "claude.ai", "ai"),
  trace("openai", "OpenAI", "openai.com", "ai"),
  trace("sora", "Sora", "sora.com", "ai"),
  site("deepseek", "DeepSeek", "chat.deepseek.com", "ai"),
  site("gemini", "Gemini", "gemini.google.com", "ai"),
  trace("perplexity", "Perplexity", "www.perplexity.ai", "ai"),
  trace("grok", "Grok", "grok.com", "ai"),
  trace("poe", "Poe", "poe.com", "ai"),
  trace("anthropic", "Anthropic", "www.anthropic.com", "ai"),
  trace("openrouter", "OpenRouter", "openrouter.ai", "ai"),
  trace("replicate", "Replicate", "replicate.com", "ai"),
  trace("together", "Together AI", "together.ai", "ai"),
  trace("mistral", "Mistral AI", "mistral.ai", "ai"),
  trace("lechat", "Le Chat", "chat.mistral.ai", "ai"),
  trace("midjourney", "Midjourney", "www.midjourney.com", "ai"),
  trace("suno", "Suno", "suno.com", "ai"),
  trace("gamma", "Gamma", "gamma.app", "ai"),
  trace("kimi", "Kimi", "www.kimi.com", "ai"),

  // Developer services
  trace("nodejs", "Node.js", "nodejs.org", "developer"),
  site("github", "GitHub", "github.com", "developer"),
  trace("gitlab", "GitLab", "gitlab.com", "developer"),
  trace("npm", "npm Registry", "registry.npmjs.org", "developer"),
  trace("bun", "Bun", "bun.sh", "developer"),
  trace("dockerhub", "Docker Hub", "hub.docker.com", "developer"),
  trace("stackoverflow", "Stack Overflow", "stackoverflow.com", "developer"),
  trace("digitalocean", "DigitalOcean", "www.digitalocean.com", "developer"),
  trace("render", "Render", "render.com", "developer"),
  trace("planetscale", "PlanetScale", "planetscale.com", "developer"),
  trace("postman", "Postman", "www.postman.com", "developer"),

  // International services
  { id: "byte-1", name: "字节跳动 · 海外 1", domain: "perfops1.byteperf.com", kind: "international", method: "headers", path: "/500b-bench.jpg" },
  { id: "byte-2", name: "字节跳动 · 海外 2", domain: "perfops2.byteperf.com", kind: "international", method: "headers", path: "/500b-bench.jpg" },
  { id: "byte-3", name: "字节跳动 · 海外 3", domain: "perfops3.byteperf.com", kind: "international", method: "headers", path: "/500b-bench.jpg" },
  trace("discord", "Discord", "discord.com", "international"),
  trace("x", "X", "x.com", "international"),
  site("tiktok", "TikTok · 官网", "www.tiktok.com", "international"),
  trace("visa", "Visa", "www.visa.com", "international"),
  site("google", "Google", "www.google.com", "international"),
  site("youtube", "YouTube", "www.youtube.com", "international"),
  site("reddit", "Reddit", "www.reddit.com", "international"),
  site("netflix", "Netflix", "www.netflix.com", "international"),
  trace("notion", "Notion", "www.notion.so", "international"),
  trace("deepl", "DeepL", "www.deepl.com", "international"),
  trace("quillbot", "QuillBot", "quillbot.com", "international"),
  trace("signal", "Signal", "signal.org", "international"),
  trace("medium", "Medium", "medium.com", "international"),
  trace("substack", "Substack", "substack.com", "international"),
  trace("patreon", "Patreon", "www.patreon.com", "international"),
  trace("kofi", "Ko-fi", "ko-fi.com", "international"),
  trace("speedtest", "Speedtest", "www.speedtest.net", "international"),
  trace("udemy", "Udemy", "www.udemy.com", "international"),
  trace("shopify", "Shopify", "www.shopify.com", "international"),

  // CDNs
  trace("cloudflare", "Cloudflare", "www.cloudflare.com", "cdn"),
  trace("cdnjs", "cdnjs", "cdnjs.cloudflare.com", "cdn"),
  trace("jsdelivr", "jsDelivr", "cdn.jsdelivr.net", "cdn"),
  trace("unpkg", "unpkg", "unpkg.com", "cdn"),

  // Game websites
  site("cs2", "CS2 · 官网", "www.counter-strike.net", "game", "/cs2"),
  site("delta-cn", "三角洲行动 · 国服官网", "df.qq.com", "game", "/index.shtml"),
  site("delta-global", "Delta Force · 国际服官网", "www.playdeltaforce.com", "game"),
  site("valorant-cn", "无畏契约 · 国服官网", "val.qq.com", "game"),
  site("valorant-global", "VALORANT · 国际服官网", "playvalorant.com", "game"),
  site("apex", "Apex Legends · 官网", "www.ea.com", "game", "/games/apex-legends/apex-legends"),
  site("pubg", "PUBG · 官网", "www.pubg.com", "game"),
  site("fortnite", "Fortnite · 官网", "www.fortnite.com", "game"),
  site("lol-cn", "英雄联盟 · 国服官网", "lol.qq.com", "game"),
  site("genshin-cn", "原神 · 国服官网", "ys.mihoyo.com", "game"),
];
