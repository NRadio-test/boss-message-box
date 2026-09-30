import type { Result } from "./probe";

const countryAliases: Record<string, string> = {
  新加坡: "SG", singapore: "SG", 香港: "HK", 中国香港: "HK", "hong kong": "HK",
  澳门: "MO", 澳門: "MO", 中国澳门: "MO", macao: "MO", macau: "MO",
  中国: "CN", 中国大陆: "CN", china: "CN", 台湾: "TW", 台灣: "TW", 中国台湾: "TW", taiwan: "TW",
  美国: "US", "united states": "US", 日本: "JP", japan: "JP", 韩国: "KR", "south korea": "KR",
  英国: "GB", "united kingdom": "GB", 德国: "DE", germany: "DE", 法国: "FR", france: "FR",
  加拿大: "CA", canada: "CA", 澳大利亚: "AU", australia: "AU", 荷兰: "NL", netherlands: "NL",
};

export function normalizeCountry(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.trim();
  if (/^[a-z]{2}$/i.test(text)) return text.toUpperCase();
  const key = text.toLowerCase();
  return Object.prototype.hasOwnProperty.call(countryAliases, key) ? countryAliases[key] : undefined;
}

export function normalizeProbeRegion(value: unknown): Pick<Result, "country" | "location"> {
  if (typeof value !== "string") return {};
  const text = value.trim().slice(0, 200);
  // Deduplicate repeated Chinese place names, without breaking English multiword names.
  const parts = text.split(/\s+|[·|,，]/).filter(Boolean);
  const location = parts.every((part) => /^[\u3400-\u9fff]+$/.test(part))
    ? [...new Set(parts)].join(" · ") : text;
  const country = normalizeCountry(location);
  return { location: /^[a-z]{2}$/i.test(location) ? undefined : location, country };
}

// Only use observations from this run. Conflicting country data must stay distinct.
export function shareIpRegions(results: Record<string, Result>): Record<string, Result> {
  const groups = new Map<string, Result[]>();
  for (const result of Object.values(results)) {
    if (result.status !== "ok" || !result.ip) continue;
    const group = groups.get(result.ip) || [];
    group.push(result);
    groups.set(result.ip, group);
  }
  return Object.fromEntries(Object.entries(results).map(([id, result]) => {
    const group = result.ip ? groups.get(result.ip) || [] : [];
    const countries = new Set(group.map((row) => row.country).filter(Boolean));
    const country = countries.size === 1 ? [...countries][0] : undefined;
    // A country alone is safe to reuse; do not infer a city or carrier from a flag.
    return [id, result.country || !country ? result : { ...result, country }];
  }));
}
