import { afterEach, expect, it, vi } from "vitest";
import { parseGeo } from "../../src/shared/iptest-geo";
import { createGeoLookup } from "../../src/features/iptest/geo";
import { browserProbe, type Target } from "../../src/features/iptest/probe";
import { jsonpProbe } from "../../src/features/iptest/jsonp-probe";

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
it("queries geolocation without modern AbortSignal helpers", async () => {
  vi.stubGlobal("AbortSignal", {});
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ ip: "1.1.1.1", country: "AU", provider: "IP.SB" })));
  expect(await createGeoLookup(new AbortController().signal)("1.1.1.1")).toMatchObject({ country: "AU" });
});
it("aborts an active geolocation request and skips queued lookups on stop", async () => {
  vi.useFakeTimers();
  const controller = new AbortController();
  const fetcher = vi.fn((_url: string, options: RequestInit) => new Promise<Response>((_resolve, reject) => {
    options.signal!.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
  }));
  vi.stubGlobal("fetch", fetcher);
  const lookup = createGeoLookup(controller.signal);
  const active = lookup("1.1.1.1");
  const queued = lookup("8.8.8.8");
  await Promise.resolve();
  controller.abort();
  expect(await active).toBeNull();
  expect(await queued).toBeNull();
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
});
it("times out a stalled geolocation request", async () => {
  vi.useFakeTimers();
  const controller = new AbortController();
  vi.stubGlobal("fetch", vi.fn((_url: string, options: RequestInit) => new Promise<Response>((_resolve, reject) => {
    options.signal!.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
  })));
  const pending = createGeoLookup(controller.signal)("1.1.1.1");
  await vi.advanceTimersByTimeAsync(8000);
  expect(await pending).toBeNull();
  controller.abort();
  await vi.runAllTimersAsync();
});
it("runs sandboxed JSONP when crypto.randomUUID is unavailable", async () => {
  vi.stubGlobal("crypto", { getRandomValues: crypto.getRandomValues.bind(crypto) });
  const controller = new AbortController();
  const pending = jsonpProbe("alibaba", controller.signal);
  const token = new URL(document.querySelector("iframe")!.src).hash.slice(1);
  expect(token).toMatch(/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/);
  controller.abort();
  await expect(pending).rejects.toMatchObject({ name: "AbortError" });
});
it("normalizes both providers and refuses a different IP", () => {
  expect(parseGeo({ ip: "1.1.1.1", country_code: "au", country: "Australia", region: "Sydney", city: "Sydney", isp: "Cloudflare" }, "1.1.1.1", "IP.SB"))
    .toMatchObject({ country: "AU", location: "Australia · Sydney", organization: "Cloudflare" });
  expect(parseGeo({ ip: "2001:db8::1", geo: { country_code: "US", country: "United States", city: "Los Angeles" }, as: { name: "Example Network" } }, "2001:db8::1", "IPinfo"))
    .toMatchObject({ country: "US", organization: "Example Network" });
  expect(parseGeo({ ip: "1.1.1.2", country: "Australia" }, "1.1.1.1", "IP.SB")).toBeNull();
  expect(parseGeo({ ip: "1.1.1.1" }, "1.1.1.1", "IPinfo")).toBeNull();
});
it("deduplicates geolocation requests and retains failure as a separate result", async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ ip: "1.1.1.1", country: "AU", location: "Australia", provider: "IP.SB" }));
  vi.stubGlobal("fetch", fetcher);
  const lookup = createGeoLookup(new AbortController().signal);
  const a = lookup("1.1.1.1");
  expect(lookup("1.1.1.1")).toBe(a);
  expect(await a).toMatchObject({ country: "AU" });
  expect(fetcher).toHaveBeenCalledTimes(1);
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
  expect(await createGeoLookup(new AbortController().signal)("1.1.1.1")).toBeNull();
});
it("reads IP headers with HEAD and never treats unrelated response data as an IP", async () => {
  const target: Target = { id: "netease", name: "网易", domain: "example.com", path: "/test.png", kind: "domestic", method: "headers" };
  const response = Object.defineProperty(new Response(null, { headers: { "cdn-user-ip": "1.1.1.1" } }), "url", { value: "https://example.com/test.png" });
  const fetcher = vi.fn().mockResolvedValue(response);
  vi.stubGlobal("fetch", fetcher);
  expect(await browserProbe(target, new AbortController().signal)).toMatchObject({ status: "ok", ip: "1.1.1.1" });
  expect(fetcher).toHaveBeenCalledWith(expect.any(URL), expect.objectContaining({ method: "HEAD" }));
});
it("isolates JSONP, ignores forged messages and cleans the frame on success", async () => {
  const result = jsonpProbe("tencent", new AbortController().signal);
  const frame = document.querySelector("iframe")!;
  expect(frame.getAttribute("sandbox")).toBe("allow-scripts");
  const token = new URL(frame.src).hash.slice(1);
  window.dispatchEvent(new MessageEvent("message", { origin: "null", source: window, data: { token, ip: "9.9.9.9" } }));
  expect(document.querySelector("iframe")).toBe(frame);
  window.dispatchEvent(new MessageEvent("message", { origin: "null", source: frame.contentWindow, data: { token, ip: "1.1.1.1" } }));
  expect(await result).toMatchObject({ ip: "1.1.1.1" });
  expect(document.querySelector("iframe")).toBeNull();
});
it("cleans up sandboxed JSONP when detection stops", async () => {
  const controller = new AbortController();
  const pending = jsonpProbe("alibaba", controller.signal);
  controller.abort();
  await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  expect(document.querySelector("iframe")).toBeNull();
});
