import { Hono } from "hono";
import { safeIp } from "../../src/shared/ip-address";
import { parseGeo, type GeoResult } from "../../src/shared/iptest-geo";
import type { Env } from "../env";
import { D1RateLimitService } from "../infra/d1-repositories";

export const iptestRoutes = new Hono<{ Bindings: Env }>();
// Coalesce identical lookups within an isolate; persistent edge cache covers subsequent requests.
const pending = new Map<string, Promise<GeoResult | null>>();
iptestRoutes.get("/geo", async (c) => {
  const ip = safeIp(c.req.query("ip"));
  if (!ip) return c.json({ error: "INVALID_IP" }, 400);
  const provider = c.env.IPINFO_TOKEN ? "IPinfo"
    : c.env.IPTEST_GEO_PROVIDER === "ipsb" || c.env.APP_ENV !== "production" ? "IP.SB" : null;
  if (!provider) return c.json({ error: "GEO_NOT_CONFIGURED" }, 503);
  const key = new Request(`https://iptest-cache.invalid/v1/${provider}/${encodeURIComponent(ip)}`);
  try {
    const cached = await caches.default.match(key);
    if (cached) return c.json(await cached.json());
  } catch { /* A cache failure must not prevent a fresh lookup. */ }
  const limits = new D1RateLimitService(c.env.BOSS_MESSAGE_DB, c.env.RATE_LIMIT_HMAC_KEY);
  const now = Date.now();
  const allowance = await limits.consume({ operation: "iptest-geo", identity: c.req.header("CF-Connecting-IP") || "local", limit: 40, windowSeconds: 60, now });
  if (!allowance.allowed) { c.header("Retry-After", String(allowance.retryAfterSeconds)); return c.json({ error: "RATE_LIMITED" }, 429); }
  const pendingKey = `${provider}:${ip}`;
  let lookup = pending.get(pendingKey);
  if (!lookup) {
    lookup = (async () => {
      // Bound provider traffic as well as per-visitor traffic, including paid usage.
      const quota = await limits.consume({ operation: "iptest-provider", identity: provider, limit: provider === "IP.SB" ? 80 : 4000, windowSeconds: provider === "IP.SB" ? 60 : 86400, now });
      if (!quota.allowed) return null;
      if (provider === "IP.SB") {
        const burst = await limits.consume({ operation: "iptest-provider-burst", identity: provider, limit: 4, windowSeconds: 1, now });
        if (!burst.allowed) return null;
      }
      const url = provider === "IPinfo" ? `https://api.ipinfo.io/lookup/${encodeURIComponent(ip)}` : `https://api.ip.sb/geoip/${encodeURIComponent(ip)}`;
      const response = await fetch(url, {
        headers: { Accept: "application/json", "User-Agent": "NRadio-IPTest/1.0", ...(provider === "IPinfo" ? { Authorization: `Bearer ${c.env.IPINFO_TOKEN}` } : {}) },
        signal: AbortSignal.timeout(6500), redirect: "manual",
      });
      if (!response.ok) {
        if (c.env.APP_ENV !== "production") console.warn("IP geolocation provider returned HTTP", response.status);
        return null;
      }
      const result = parseGeo(await response.json(), ip, provider);
      if (result) {
        try {
          await caches.default.put(key, new Response(JSON.stringify(result), { headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=86400" } }));
        } catch { /* Preserve valid provider data even when the cache cannot be written. */ }
      }
      return result;
    })().catch((error: unknown) => {
      if (c.env.APP_ENV !== "production") console.warn("IP geolocation lookup failed", error instanceof Error ? error.message.replaceAll(c.env.IPINFO_TOKEN || "__no_token__", "[redacted]") : "unknown");
      return null;
    }).finally(() => pending.delete(pendingKey));
    pending.set(pendingKey, lookup);
  }
  const result = await lookup;
  return result ? c.json(result) : c.json({ error: "GEO_UNAVAILABLE" }, 503);
});
