export function safeIp(value: unknown): string {
  if (typeof value !== "string") return "";
  const ip = value.trim();
  if (/^(?:(?:0|[1-9]\d{0,2})\.){3}(?:0|[1-9]\d{0,2})$/.test(ip) && ip.split(".").every((n) => +n <= 255)) return ip;
  if (ip.includes(":") && /^[\da-f:.]+$/i.test(ip)) {
    try { return new URL(`http://[${ip}]/`).hostname.slice(1, -1); } catch { return ""; }
  }
  return "";
}
