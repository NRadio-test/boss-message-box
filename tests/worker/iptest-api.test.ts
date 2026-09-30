import { env } from "cloudflare:workers";
import { afterEach, expect, it, vi } from "vitest";
import { iptestRoutes } from "../../worker/routes/iptest";
import type { Env } from "../../worker/env";
const bindings = { ...env, APP_ENV: "test", RATE_LIMIT_HMAC_KEY: "MzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzM=" } as unknown as Env;
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it("preserves provider results when cache reads and writes fail", async () => {
  const cache = { match: vi.fn().mockRejectedValue(new Error("cache unavailable")), put: vi.fn().mockRejectedValue(new Error("cache full")) };
  vi.stubGlobal("caches", { default: cache });
  vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ ip: "1.0.0.1", geo: { country_code: "AU", country: "Australia" } }));
  const response = await iptestRoutes.request("https://test/geo?ip=1.0.0.1", {}, { ...bindings, IPINFO_TOKEN: "test-token" });
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ ip: "1.0.0.1", country: "AU" });
  expect(cache.put).toHaveBeenCalledTimes(1);
});
it("validates addresses and requires explicit production provider configuration", async () => {
  expect((await iptestRoutes.request("https://test/geo?ip=https://evil.test", {}, bindings)).status).toBe(400);
  expect((await iptestRoutes.request("https://test/geo?ip=1.1.1.1", {}, { ...bindings, APP_ENV: "production", IPINFO_TOKEN: undefined, IPTEST_GEO_PROVIDER: undefined })).status).toBe(503);
});
it("looks up the supplied exit IP, caches it, and keeps provider credentials server-side", async () => {
  const fetcher = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ ip: "8.8.4.4", geo: { country_code: "US", country: "United States", city: "Mountain View" }, as: { name: "Google LLC" } }));
  const options = { ...bindings, IPINFO_TOKEN: "test-secret-token" };
  const response = await iptestRoutes.request("https://test/geo?ip=8.8.4.4", {}, options);
  expect(response.status).toBe(200);
  const body = await response.text();
  expect(body).toContain("Google LLC");
  expect(body).not.toContain("test-secret-token");
  expect(fetcher).toHaveBeenCalledWith("https://api.ipinfo.io/lookup/8.8.4.4", expect.objectContaining({ redirect: "manual", headers: expect.objectContaining({ Authorization: "Bearer test-secret-token" }) }));
  expect((await iptestRoutes.request("https://test/geo?ip=8.8.4.4", {}, options)).status).toBe(200);
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it("does not cache mismatched provider results or replace them with the server's own IP", async () => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ ip: "9.9.9.9", country: "United States" }));
  expect((await iptestRoutes.request("https://test/geo?ip=8.8.8.8", {}, bindings)).status).toBe(503);
});
