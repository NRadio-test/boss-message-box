import { safeIp } from "./ip-address";
export interface GeoResult { ip: string; country?: string; location?: string; organization?: string; provider: "IP.SB" | "IPinfo" }
const text = (value: unknown) => typeof value === "string" ? value.trim().slice(0, 200) : "";
const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" ? value as Record<string, unknown> : {};
export function parseGeo(value: unknown, ip: string, provider: GeoResult["provider"]): GeoResult | null {
  const data = record(value);
  if (safeIp(data.ip) !== ip) return null;
  const geo = provider === "IPinfo" ? record(data.geo) : data;
  const as = record(data.as);
  const code = text(geo.country_code).toUpperCase();
  const location = [...new Set([geo.country, geo.region, geo.city].map(text).filter(Boolean))].join(" · ");
  const organization = text(provider === "IPinfo" ? as.name : data.isp || data.organization || data.asn_organization);
  if (!location && !organization) return null;
  return { ip, country: /^[A-Z]{2}$/.test(code) ? code : undefined, location, organization, provider };
}
