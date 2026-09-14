import { Broadcast } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import { Button } from "../../../components/Button";
import { createRandomUuid } from "../../../lib/random-id";
import type { StudioFeedbackDetail } from "../../../shared/studio-contracts";
import { getStudioFeedback, StudioApiError } from "../api";
import { getActiveBatch, removeLiveFeedback, routeLiveFeedback } from "../live-api";
import { resetLiveSequence } from "../live-sequence";

interface Props {
  item: StudioFeedbackDetail;
  disabled: boolean;
  onPendingChange: (pending: boolean) => void;
  onUpdated: (item: StudioFeedbackDetail) => void;
}
interface Attempt { batchId: string; requestKey: string; remove: boolean; saved: boolean }

/** Key by feedback id: retries must never apply another message's operation. */
export function LiveSelectionControl({ item, disabled, onPendingChange, onUpdated }: Props) {
  const attempt = useRef<Attempt | null>(null);
  const running = useRef(false);
  const mounted = useRef(true);
  const container = useRef<HTMLDivElement>(null);
  const restoreFocus = useRef(false);
  const [busy, setBusy] = useState(false);
  const [retry, setRetry] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  useEffect(() => {
    if (!busy && restoreFocus.current) {
      restoreFocus.current = false;
      if (document.activeElement === document.body) {
        container.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus({ preventScroll: true });
      }
    }
  }, [busy]);

  const update = async () => {
    if (disabled || running.current) return;
    running.current = true;
    restoreFocus.current = container.current?.contains(document.activeElement) ?? false;
    setBusy(true); setError(null); setNotice(null); onPendingChange(true);
    try {
      if (!attempt.current) {
        const { batch } = await getActiveBatch();
        if (!mounted.current) return;
        attempt.current = { batchId: batch.id, requestKey: createRandomUuid(), remove: Boolean(item.liveSelected), saved: false };
      }
      const current = attempt.current;
      if (!current.saved) {
        if (current.remove) await removeLiveFeedback(item.id, { batchId: current.batchId, requestKey: current.requestKey });
        else await routeLiveFeedback(item.id, { batchId: current.batchId, requestKey: current.requestKey, routingStatus: "selected" });
        current.saved = true;
        resetLiveSequence();
        window.dispatchEvent(new Event("studio:batch-changed"));
      }
      // Once saved, retries only refresh. Never repeat a successful mutation with a new key.
      const result = await getStudioFeedback(item.id);
      if (!mounted.current) return;
      onUpdated(result.item);
      setNotice(result.item.liveSelected ? "已选入直播展示" : "当前未选入直播展示");
      attempt.current = null;
      setRetry(false);
      onPendingChange(false);
    } catch (reason) {
      if (!mounted.current) return;
      // Definitive rejection has no mutation to retry; refresh stale membership/eligibility.
      if (!attempt.current?.saved && reason instanceof StudioApiError && reason.status >= 400 && reason.status < 500) {
        attempt.current = null;
        try {
          const result = await getStudioFeedback(item.id);
          if (mounted.current) onUpdated(result.item);
        } catch { /* Preserve the original error. */ }
      }
      if (!mounted.current) return;
      onPendingChange(Boolean(attempt.current));
      setRetry(Boolean(attempt.current));
      setError(reason instanceof Error ? reason.message : "直播展示更新失败，请重试");
    } finally {
      running.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  const unavailable = !retry && !item.liveSelected && item.moderationStatus !== "kept";
  return (
    <div ref={container} className="studio-live-selection-control">
      <Button type="button" variant="secondary" icon={<Broadcast aria-hidden="true" />}
        loading={busy} loadingLabel="正在更新直播展示"
        disabled={disabled || unavailable} onClick={() => void update()}
        aria-describedby={unavailable ? "studio-live-selection-hint" : undefined}>
        {error && retry ? "重试直播展示操作" : item.liveSelected ? "取消直播展示" : "选入直播展示"}
      </Button>
      {unavailable && <small id="studio-live-selection-hint">{item.moderationStatus === "filtered" ? "请先恢复留言" : "请先完成内容筛选"}</small>}
      {error && <p className="studio-field-error" role="alert">{error}{retry && "；请重试以确认结果。"}</p>}
      {notice && <small role="status">{item.liveSelected ? "已选入直播展示" : "当前未选入直播展示"}</small>}
    </div>
  );
}
