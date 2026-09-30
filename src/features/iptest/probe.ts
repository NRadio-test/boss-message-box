import { safeIp } from "../../shared/ip-address";
import { jsonpProbe } from "./jsonp-probe";
export { safeIp } from "../../shared/ip-address";

export type Method = "trace" | "echo" | "ping0" | "headers" | "alibaba" | "tencent" | "site";
export type Kind = "probe" | "domestic" | "ai" | "developer" | "international" | "cdn" | "game" | "custom";
export interface Target {
  id: string;
  name: string;
  domain: string;
  path: string;
  kind: Kind;
  method: Method;
}
export interface Result {
  status: "queued" | "loading" | "ok" | "responded" | "unavailable" | "timeout" | "stopped";
  ip?: string;
  country?: string;
  location?: string;
  organization?: string;
  geoStatus?: "loading" | "ok" | "unavailable";
  geoProvider?: string;
  message?: string;
  latency?: number;
}
export const kindLabels: Record<Kind | "all", string> = {
  all: "全部", probe: "IP 查询", domestic: "国内", ai: "AI 工具", developer: "开发服务", international: "国际",
  cdn: "CDN", game: "游戏", custom: "自定义",
};
export const storageKey = "route-check-custom-v1";
const hostnamePattern = /^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

export function targetError(target: Pick<Target, "domain" | "path" | "method">): string {
  if (!hostnamePattern.test(target.domain) || /\.(local|localhost|internal)$/.test(target.domain)) {
    return "请输入公开域名，例如 example.com。";
  }
  if (!target.path.startsWith("/") || target.path.startsWith("//") || target.path.length > 512 || /[\\#\s]/.test(target.path)) {
    return "路径须以 / 开头，不能包含空格、反斜杠或 #。";
  }
  if (!["trace", "echo", "site"].includes(target.method)) return "请选择有效的检测方式。";
  return "";
}

export function loadCustom(): Target[] {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(storageKey) || "[]");
    if (!Array.isArray(saved)) return [];
    const seen = new Set<string>();
    return saved.filter((item): item is Target => {
      if (!item || typeof item !== "object") return false;
      const valid = typeof item.id === "string" && item.id.startsWith("custom-") && !seen.has(item.id)
        && typeof item.name === "string" && item.name.trim().length > 0 && item.name.length <= 253
        && item.kind === "custom" && typeof item.domain === "string" && typeof item.path === "string"
        && !targetError(item);
      if (valid) seen.add(item.id);
      return valid;
    }).slice(0, 30);
  } catch { return []; }
}

function countryCode(value: unknown): string {
  return typeof value === "string" && /^[a-z]{2}$/i.test(value) ? value.toUpperCase() : "";
}
export function parseResponse(text: string, method: Method): Pick<Result, "ip" | "country" | "location"> {
  if (method === "ping0") {
    const lines = text.trim().split(/\r?\n/);
    return { ip: safeIp(lines[0]), location: (lines[1] || "").slice(0, 160) };
  }
  if (method === "trace") {
    const pairs = Object.fromEntries(text.split(/\r?\n/).filter((line) => line.includes("="))
      .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]));
    return { ip: safeIp(pairs.ip), country: countryCode(pairs.loc) };
  }
  try {
    const value: unknown = JSON.parse(text);
    if (value && typeof value === "object") {
      const data = value as Record<string, unknown>;
      for (const key of ["ip", "ip_address", "address", "query"]) {
        const ip = safeIp(data[key]);
        if (ip) return { ip, country: countryCode(data.country_code) || countryCode(data.country) };
      }
    }
  } catch { /* Some IP endpoints return plain text. */ }
  return { ip: safeIp(text) };
}
export function endpoint(target: Target): string { return `https://${target.domain}${target.path}`; }

export function locationName(result: Result): string {
  if (result.location) return result.location;
  if (result.country) {
    try {
      return typeof Intl.DisplayNames === "function"
        ? new Intl.DisplayNames(["zh-CN"], { type: "region" }).of(result.country) || result.country
        : result.country;
    } catch { return result.country; }
  }
  return "位置未提供";
}

// Requests must originate in the visitor's browser: a Worker proxy would measure the server's route.
export async function browserProbe(target: Target, signal: AbortSignal): Promise<Result> {
  if (signal.aborted) return { status: "stopped" };
  const controller = new AbortController();
  const cancel = () => controller.abort();
  signal.addEventListener("abort", cancel, { once: true });
  let timedOut = false;
  const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, 8500);
  const start = performance.now();
  const elapsed = () => Math.round(performance.now() - start);
  try {
    if (target.method === "alibaba" || target.method === "tencent" || target.method === "ping0") {
      const data = await jsonpProbe(target.method, controller.signal);
      const ip = safeIp(data.ip);
      return ip ? { status: "ok", ip, location: data.location, latency: elapsed() }
        : { status: "unavailable", message: "未提供出口 IP", latency: elapsed() };
    }
    const url = new URL(endpoint(target));
    if (target.method !== "site") url.searchParams.set("_split_probe", String(Date.now()));
    const response = await fetch(url, {
      method: target.method === "headers" ? "HEAD" : "GET",
      mode: target.method === "site" ? "no-cors" : "cors", credentials: "omit",
      cache: "no-store", referrerPolicy: "no-referrer", signal: controller.signal,
    });
    if (target.method === "site") {
      // Opaque responses do not reveal HTTP status or whether access succeeded.
      controller.abort();
      return { status: "responded", message: "已收到响应", latency: elapsed() };
    }
    if (new URL(response.url).hostname !== target.domain) {
      return { status: "unavailable", message: "已跳转，无法确认出口", latency: elapsed() };
    }
    if (!response.ok) return { status: "unavailable", message: "接口暂不可用", latency: elapsed() };
    const parsed = target.method === "headers"
      ? { ip: safeIp(response.headers.get("cdn-user-ip")) || safeIp(response.headers.get("x-request-ip")) || safeIp(response.headers.get("x-response-cinfo")?.split(",")[0]) }
      : parseResponse((await response.text()).slice(0, 32768), target.method);
    return parsed.ip
      ? { status: "ok", ...parsed, latency: elapsed() }
      : { status: "unavailable", message: "未提供出口 IP", latency: elapsed() };
  } catch {
    return { status: signal.aborted ? "stopped" : timedOut ? "timeout" : "unavailable",
      message: timedOut ? "连接超时，请重试" : "无法读取，可打开核对" };
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener("abort", cancel);
  }
}
