import { createRandomUuid } from "../../lib/random-id";

// Third-party JSONP executes in an opaque sandbox, never in the message board's origin.
export function jsonpProbe(provider: "alibaba" | "tencent" | "ping0", signal: AbortSignal): Promise<{ ip?: string; location?: string }> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(new DOMException("Aborted", "AbortError")); return; }
    const token = createRandomUuid();
    const frame = document.createElement("iframe");
    frame.hidden = true;
    frame.title = "出口检测";
    frame.setAttribute("sandbox", "allow-scripts");
    frame.referrerPolicy = "no-referrer";
    frame.src = `/iptest-probe.html?provider=${provider}#${token}`;
    const cleanup = () => {
      window.removeEventListener("message", receive);
      signal.removeEventListener("abort", cancel);
      frame.remove();
    };
    const cancel = () => { cleanup(); reject(new DOMException("Aborted", "AbortError")); };
    const receive = (event: MessageEvent) => {
      if (event.source !== frame.contentWindow || event.origin !== "null" || event.data?.token !== token) return;
      cleanup();
      if (event.data.error) { reject(new Error("Probe unavailable")); return; }
      resolve({ ip: typeof event.data.ip === "string" ? event.data.ip.slice(0, 64) : undefined,
        location: typeof event.data.location === "string" ? event.data.location.slice(0, 200) : undefined });
    };
    window.addEventListener("message", receive);
    signal.addEventListener("abort", cancel, { once: true });
    document.body.append(frame);
  });
}
