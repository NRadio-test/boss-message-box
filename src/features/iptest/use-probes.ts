import { useCallback, useEffect, useRef, useState } from "react";
import { createGeoLookup } from "./geo";
import { browserProbe, type Result, type Target } from "./probe";
import { shareIpRegions } from "./region";

export function useProbes(initialTargets: Target[] = []) {
  const initial = useRef(initialTargets);
  const [results, setResults] = useState<Record<string, Result>>({});
  const [running, setRunning] = useState(false);
  const [lastRun, setLastRun] = useState("");
  const active = useRef<AbortController | null>(null);
  useEffect(() => () => { active.current?.abort(); active.current = null; }, []);

  const run = useCallback(async (targets: Target[], reset = false) => {
    if (active.current) return;
    const controller = new AbortController();
    active.current = controller;
    setRunning(true);
    const observations = Object.fromEntries(targets.map((target) => [target.id, { status: "queued" } as Result]));
    setResults((previous) => ({ ...(reset ? {} : previous), ...observations }));
    function publish(id: string, result: Result) {
      observations[id] = result;
      const shared = shareIpRegions(observations);
      setResults((previous) => ({ ...previous, ...shared }));
    }
    const geoErrors = new Map<string, NonNullable<Result["geoError"]>>();
    const lookupGeo = createGeoLookup(controller.signal, (ip, reason) => geoErrors.set(ip, reason));
    const enrichments: Promise<void>[] = [];
    let next = 0;
    async function worker() {
      while (next < targets.length && !controller.signal.aborted) {
        const target = targets[next++];
        if (!target) break;
        publish(target.id, { status: "loading" });
        const result = await browserProbe(target, controller.signal);
        if (active.current !== controller) return;
        publish(target.id, { ...result, geoStatus: result.ip ? "loading" : undefined });
        if (result.ip) enrichments.push(lookupGeo(result.ip).then((geo) => {
          if (active.current !== controller) return;
          publish(target.id, { ...result,
            ...(geo ? { country: geo.country || result.country, location: geo.location || result.location,
              organization: geo.organization, geoProvider: geo.provider } : {}),
            geoStatus: geo ? "ok" : "unavailable", geoError: geo ? undefined : geoErrors.get(result.ip!) });
        }));
      }
    }
    await Promise.all(Array.from({ length: Math.min(6, targets.length) }, worker));
    await Promise.all(enrichments);
    if (active.current !== controller) return;
    active.current = null;
    setRunning(false);
    setLastRun(new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }));
  }, []);
  useEffect(() => {
    const timer = setTimeout(() => { if (initial.current.length) void run(initial.current, true); }, 0);
    return () => clearTimeout(timer);
  }, [run]);
  function stop() {
    active.current?.abort();
    active.current = null;
    setRunning(false);
    setResults((previous) => Object.fromEntries(Object.entries(previous).map(([id, result]) => [id,
      result.status === "queued" || result.status === "loading" ? { status: "stopped" } : { ...result, geoStatus: result.geoStatus === "loading" ? "unavailable" : result.geoStatus },
    ])));
  }
  function remove(id: string) {
    setResults((previous) => Object.fromEntries(Object.entries(previous).filter(([key]) => key !== id)));
  }
  return { results, running, lastRun, run, stop, remove };
}
