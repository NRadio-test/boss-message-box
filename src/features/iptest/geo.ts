import { safeIp } from "../../shared/ip-address";
import type { GeoResult } from "../../shared/iptest-geo";
import type { Result } from "./probe";
import { normalizeCountry } from "./region";

// One request per distinct exit IP per run, with a serial queue to respect provider limits.
export function createGeoLookup(signal: AbortSignal, onError?: (ip: string, reason: NonNullable<Result["geoError"]>) => void) {
  const pending = new Map<string, Promise<GeoResult | null>>();
  let queue: Promise<unknown> = Promise.resolve();
  return (ip: string) => {
    const existing = pending.get(ip);
    if (existing) return existing;
    const lookup = queue.then(async (): Promise<GeoResult | null> => {
      if (signal.aborted) return null;
      const controller = new AbortController();
      const cancel = () => controller.abort();
      signal.addEventListener("abort", cancel, { once: true });
      const timeout = setTimeout(cancel, 8000);
      try {
        const response = await fetch(`/api/iptest/geo?ip=${encodeURIComponent(ip)}`, {
          signal: controller.signal, credentials: "omit", cache: "no-store",
        });
        if (!response.ok) {
          const data = await response.json().catch(() => null) as { error?: string } | null;
          onError?.(ip, data?.error === "GEO_NOT_CONFIGURED" ? "not-configured" : response.status === 429 ? "rate-limited" : "unavailable");
          return null;
        }
        const data = await response.json() as GeoResult;
        if (safeIp(data.ip) !== ip || !["IP.SB", "IPinfo"].includes(data.provider)) {
          onError?.(ip, "unavailable");
          return null;
        }
        return { ip, country: normalizeCountry(data.country),
          location: typeof data.location === "string" ? data.location.slice(0, 600) : undefined,
          organization: typeof data.organization === "string" ? data.organization.slice(0, 200) : undefined, provider: data.provider };
      } catch {
        if (!signal.aborted) onError?.(ip, controller.signal.aborted ? "timeout" : "unavailable");
        return null;
      }
      finally {
        clearTimeout(timeout);
        signal.removeEventListener("abort", cancel);
      }
    });
    queue = lookup.then(() => signal.aborted ? undefined : new Promise((resolve) => setTimeout(resolve, 260)));
    pending.set(ip, lookup);
    return lookup;
  };
}
