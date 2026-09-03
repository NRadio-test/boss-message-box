import { useEffect, useState } from "react";
import type { StudioStatsSuccess } from "../../../shared/studio-contracts";
import { getStudioStats } from "../api";

export function StudioStats() {
  const [stats, setStats] = useState<StudioStatsSuccess | null>(null);
  const [failed, setFailed] = useState(false);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    getStudioStats(controller.signal)
      .then((value) => {
        setStats(value);
        setFailed(false);
      })
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true);
      });
    return () => controller.abort();
  }, [reload]);

  if (failed) {
    return (
      <div className="studio-stats-unavailable">
        <span>统计暂时无法加载</span>
        <button type="button" onClick={() => setReload((value) => value + 1)}>重试</button>
      </div>
    );
  }

  const items = [
    ["今日留言", stats?.todayFeedback],
    ["未回复", stats?.unreplied],
    ["待办", stats?.todo],
    ["今日已回复", stats?.todayReplied],
  ] as const;
  return (
    <dl className="studio-stats" aria-label="留言统计" aria-busy={!stats}>
      {items.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value ?? "—"}</dd>
        </div>
      ))}
    </dl>
  );
}
