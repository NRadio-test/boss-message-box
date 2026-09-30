import { afterEach, describe, expect, it, vi } from "vitest";
import { browserProbe, loadCustom, parseResponse, safeIp, storageKey, targetError, type Target } from "../../src/features/iptest/probe";

const target: Target = { id: "test", name: "Test", domain: "example.com", path: "/ip", kind: "probe", method: "echo" };
function response(body: string, url = "https://example.com/ip", status = 200) {
  return Object.defineProperty(new Response(body, { status }), "url", { value: url });
}
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("browser network probes", () => {
  it("parses only valid IPs from trace, JSON and plain text endpoints", () => {
    expect(parseResponse("ip=203.0.113.9\nloc=HK\n", "trace")).toMatchObject({ ip: "203.0.113.9", country: "HK" });
    expect(parseResponse('{"ip":"2001:db8::1","country":"US"}', "echo")).toMatchObject({ ip: "2001:db8::1", country: "US" });
    expect(parseResponse("203.0.113.1\n香港\n", "ping0")).toMatchObject({ ip: "203.0.113.1", location: "香港" });
    expect(parseResponse("<html>203.0.113.1</html>", "echo").ip).toBe("");
    for (const ip of ["999.2.3.4", "1.2.3", "01.2.3.4", ":::", "<script>", null]) expect(safeIp(ip)).toBe("");
  });
  it("sends IP requests from the browser without credentials or referrer", async () => {
    const fetcher = vi.fn().mockResolvedValue(response('{"ip":"203.0.113.1"}'));
    vi.stubGlobal("fetch", fetcher);
    expect(await browserProbe(target, new AbortController().signal)).toMatchObject({ status: "ok", ip: "203.0.113.1" });
    expect(fetcher).toHaveBeenCalledWith(expect.any(URL), expect.objectContaining({ mode: "cors", credentials: "omit", cache: "no-store", referrerPolicy: "no-referrer" }));
    expect(String(fetcher.mock.calls[0]?.[0])).toContain("https://example.com/ip?");
  });
  it("does not mistake opaque responses for a working website or an exit IP", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ type: "opaque", status: 0, ok: false }));
    const result = await browserProbe({ ...target, method: "site" }, new AbortController().signal);
    expect(result).toMatchObject({ status: "responded", message: "已收到响应" });
    expect(result.ip).toBeUndefined();
  });
  it("rejects IPs from a different host after redirect", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response("203.0.113.1", "https://other.example/ip")));
    expect(await browserProbe(target, new AbortController().signal)).toMatchObject({ status: "unavailable", message: "已跳转，无法确认出口" });
  });
  it("keeps HTTP errors and CORS failures readable without reporting a disconnected network", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(response("", undefined, 403)).mockRejectedValueOnce(new TypeError("Failed to fetch"));
    vi.stubGlobal("fetch", fetcher);
    expect(await browserProbe(target, new AbortController().signal)).toMatchObject({ message: "接口暂不可用" });
    expect(await browserProbe(target, new AbortController().signal)).toMatchObject({ status: "unavailable", message: "无法读取，可打开核对" });
  });
  it("times out and cancels pending requests", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn((_url, options: RequestInit) => new Promise((_resolve, reject) => {
      options.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
    })));
    const timed = browserProbe(target, new AbortController().signal);
    await vi.advanceTimersByTimeAsync(8500);
    expect(await timed).toMatchObject({ status: "timeout" });
    const controller = new AbortController();
    const stopped = browserProbe(target, controller.signal);
    controller.abort();
    expect(await stopped).toMatchObject({ status: "stopped" });
    expect(await browserProbe(target, controller.signal)).toMatchObject({ status: "stopped" });
    expect(vi.getTimerCount()).toBe(0);
  });
});
describe("custom sites", () => {
  it("rejects private hostnames and unsafe paths", () => {
    for (const domain of ["localhost", "example.local", "127.0.0.1", "user@example.com", "example.com/x"]) expect(targetError({ ...target, domain })).not.toBe("");
    for (const path of ["//elsewhere.com", "/foo bar", "/foo\\bar", "/#hash"]) expect(targetError({ ...target, path })).not.toBe("");
    expect(targetError(target)).toBe("");
  });
  it("migrates valid saved sites while rejecting corrupted, duplicate and invalid records", () => {
    const saved = { ...target, id: "custom-old", kind: "custom" };
    localStorage.setItem(storageKey, JSON.stringify([saved, saved, null, { ...saved, id: "custom-invalid", path: 1 }, { ...saved, id: "custom-other", method: "unsupported" }]));
    expect(loadCustom()).toEqual([saved]);
    localStorage.setItem(storageKey, "broken json");
    expect(loadCustom()).toEqual([]);
  });
});
