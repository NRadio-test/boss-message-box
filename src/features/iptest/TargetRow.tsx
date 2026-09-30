import { ArrowClockwise, ArrowUpRight, Copy } from "@phosphor-icons/react";
import { useState } from "react";
import { endpoint, locationName, type Result, type Target } from "./probe";
import { siteLogos } from "./site-logos";

function resultLabel(result?: Result): string {
  if (!result) return "等待检测";
  switch (result.status) {
    case "queued": return "等待检测";
    case "loading": return "检测中…";
    case "stopped": return "已停止";
    case "ok": {
      if (result.location || result.country) return locationName(result);
      if (result.geoStatus === "loading") return "正在查询归属地…";
      if (result.geoError === "not-configured") return "归属地服务暂未启用";
      if (result.geoError === "rate-limited") return "查询较频繁，请稍后重试";
      if (result.geoError === "timeout") return "归属地查询超时，可重测";
      return "归属地暂不可用，可重测";
    }
    default: return result.message || "暂时无法读取";
  }
}

function SiteLogo({ target }: { target: Target }) {
  const [failed, setFailed] = useState(false);
  const src = siteLogos[target.id];
  const fallback = !src || failed;
  return <span className={`iptest-site-logo${fallback ? " iptest-site-logo--fallback" : ""}`} aria-hidden="true">
    {fallback ? target.name.trim().slice(0, 1).toUpperCase()
      : <img src={src} alt="" width={24} height={24} loading="lazy" decoding="async" onError={() => setFailed(true)} />}
  </span>;
}

export function TargetRow({ target, result, running, onRetry, onRemove }: {
  target: Target; result?: Result; running: boolean; onRetry: () => void; onRemove: () => void;
}) {
  const [copyState, setCopyState] = useState("");
  const responseTime = result && (result.status === "ok" || result.status === "responded") ? result.latency : undefined;
  async function copy() {
    try { await navigator.clipboard.writeText(result?.ip || target.domain); setCopyState("已复制"); }
    catch { setCopyState("复制失败，请手动选择"); }
  }
  return <tr>
    <th scope="row"><div className="iptest-site"><SiteLogo target={target} /><div className="iptest-site-text">
      <span className="iptest-site-name">{target.name}</span><span className="iptest-domain">{target.domain}</span>
    </div></div></th>
    <td className="iptest-country"><span className="iptest-flag" role="img" aria-label={result?.country ? locationName({ status: "ok", country: result.country }) : "地区未知"}>
      {result?.country ? [...result.country].map((letter) => String.fromCodePoint(letter.charCodeAt(0) + 127397)).join("") : "—"}
    </span></td>
    <td className="iptest-address">{result?.ip || "—"}</td>
    <td className="iptest-latency"><span className="iptest-latency-label">响应耗时 </span>
      {responseTime !== undefined ? <span className="iptest-latency-value">{responseTime} <span className="iptest-latency-unit">ms</span></span>
        : <span className="iptest-latency-empty">{result?.status === "loading" ? "测量中…" : result?.status === "timeout" ? "超时" : "—"}</span>}
    </td>
    <td className="iptest-geo"><div className={`iptest-result iptest-result--${result?.status || "idle"}`}>
      <span>{resultLabel(result)}</span>
    </div>{result?.organization && <span className="iptest-organization">{result.organization}</span>}</td>
    <td className="iptest-controls"><div className="iptest-row-actions">
      <button type="button" onClick={onRetry} disabled={running} aria-label={`重测${target.name}`} title="重新检测"><ArrowClockwise aria-hidden="true" /></button>
      <button type="button" onClick={() => void copy()} aria-label={`复制${target.name}${result?.ip ? " IP" : "域名"}`} title={result?.ip ? "复制 IP" : "复制域名"}><Copy aria-hidden="true" /></button>
      <a href={endpoint(target)} target="_blank" rel="noopener noreferrer" aria-label={`打开${target.name}核对`} title="打开核对"><ArrowUpRight aria-hidden="true" /></a>
      {target.kind === "custom" && <button type="button" className="iptest-remove" disabled={running} onClick={onRemove} aria-label={`删除${target.name}`}>删除</button>}
    </div>{copyState && <span className="iptest-copy-state" role="status">{copyState}</span>}</td>
  </tr>;
}
