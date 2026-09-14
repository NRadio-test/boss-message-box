import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { useLocation, useNavigate, useOutletContext, useSearchParams } from "react-router-dom";
import { Button } from "../../../components/Button";
import { createRandomUuid } from "../../../lib/random-id";
import type { LiveBatch, LiveListSuccess, LiveMoveInput } from "../../../shared/live-contracts";
import { STUDIO_PAGE_SIZE } from "../../../shared/studio-contracts";
import { getLiveBatches, getLiveEntries, getLiveSequence, rotateLiveBatch, removeLiveEntry, moveLiveEntry } from "../live-api";
import { StudioApiError } from "../api";
import { LiveOrderControl } from "../components/LiveOrderControl";
import { LiveEntryCard } from "../components/LiveEntryCard";
import { captureReturnContext, loadListReturn, saveListReturn, restoreListPosition, type StudioReturnContext } from "../navigation-context";
import { resetLiveSequence } from "../live-sequence";
import { StudioEmpty, StudioError, StudioLoading } from "../components/AsyncState";
import { ConfirmDialog } from "../components/ConfirmDialog";
import type { StudioOutletContext } from "../components/StudioShell";

function batchTime(timestamp: number): string {
  return new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(timestamp);
}
export function LiveDisplayPage() {
  const { liveMode } = useOutletContext<StudioOutletContext>();
  const [query, setQuery] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  const historyKey = `${location.key}:${location.pathname}${location.search}`;
  const restoreContext = useMemo(() => (location.state as { restoreContext?: StudioReturnContext } | null)?.restoreContext
    ?? loadListReturn(historyKey), [historyKey, location.state]);
  const restored = useRef<string | null>(null);
  const [expandedState, setExpandedState] = useState<{ key: string; ids: string[] } | null>(null);
  const batchId = liveMode ? null : query.get("batch");
  const page = Math.max(1, Number(query.get("page")) || 1);
  const resultKey = `${batchId ?? "current"}:${page}:${liveMode}`;
  const [loaded, setLoaded] = useState<{ key: string; result: LiveListSuccess } | null>(null);
  const result = loaded?.key === resultKey ? loaded.result : null;
  const expandedIds = expandedState?.key === resultKey ? expandedState.ids : restoreContext?.expandedIds ?? [];
  const [batches, setBatches] = useState<LiveBatch[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);
  const [movingId, setMovingId] = useState<string | null>(null);
  const [orderIssue, setOrderIssue] = useState<{ message: string; retry: boolean } | null>(null);
  const moveRequest = useRef<{ entryId: string; input: LiveMoveInput } | null>(null);
  const restoreOrderFocus = useRef<{ entryId: string; element: HTMLElement | null } | null>(null);
  const rotation = useRef<{ batchId: string; key: string } | null>(null);
  const lock = useRef(false);
  const archived = result?.batch.status === "archived";
  const changed = useCallback(() => setReload(n => n + 1), []);
  const controlsDisabled = busy || Boolean(orderIssue);
  useEffect(() => {
    if (!result || liveMode || !restoreContext || restored.current === location.key) return;
    if (restoreContext.batchId && restoreContext.batchId !== result.batch.id) return;
    const frame = requestAnimationFrame(() => {
      restoreListPosition(restoreContext);
      restored.current = location.key;
    });
    return () => cancelAnimationFrame(frame);
  }, [result, liveMode, restoreContext, location.key]);
  const openEntry = (event: MouseEvent<HTMLAnchorElement>, target: string, element: HTMLElement | null, entryId: string) => {
    if (!result) return;
    const returnQuery = new URLSearchParams(query);
    returnQuery.set("batch", result.batch.id);
    const context: StudioReturnContext = { ...captureReturnContext(`/studio/live-display?${returnQuery}`, entryId,
      result.items.map(item => item.id), element), expandedIds, batchId: result.batch.id };
    saveListReturn(historyKey, context);
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    navigate(target, { state: { returnContext: context } });
    window.scrollTo({ top: 0, behavior: "instant" });
  };
  useEffect(() => {
    const focus = restoreOrderFocus.current;
    if (busy || !focus || !result?.items.some(item => item.id === focus.entryId)) return;
    restoreOrderFocus.current = null;
    const previous = focus.element;
    if (previous?.isConnected && !previous.matches(":disabled")) previous.focus();
    else document.querySelector<HTMLInputElement>(`[data-feedback-id="${focus.entryId}"] .studio-live-slot-number`)?.focus();
  }, [busy, result]);
  useEffect(() => {
    const controller = new AbortController();
    const read = async () => {
      const value = await getLiveEntries(batchId, page, controller.signal);
      if (controller.signal.aborted) return;
      setLoaded({ key: resultKey, result: value }); setError(null);
      if (liveMode) {
        const start = await getLiveSequence(value.batch.id);
        if (!controller.signal.aborted && start.feedbackId) navigate(`/studio/feedback/${start.feedbackId}?${new URLSearchParams({ mode: "live", view: "live_display", batch: value.batch.id })}`, { replace: true });
      } else {
        const batchList = await getLiveBatches(controller.signal);
        if (!controller.signal.aborted) setBatches(batchList.batches);
      }
    };
    void read().catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "直播批次加载失败"); });
    return () => controller.abort();
  }, [batchId, liveMode, navigate, page, reload, resultKey]);
  useEffect(() => {
    if (!liveMode) return;
    const timer = window.setInterval(changed, 5000);
    return () => window.clearInterval(timer);
  }, [changed, liveMode]);
  const rotate = async () => {
    if (!result || lock.current) return;
    lock.current = true; setBusy(true); setError(null);
    rotation.current ??= { batchId: result.batch.id, key: createRandomUuid() };
    try {
      await rotateLiveBatch(rotation.current.batchId, rotation.current.key);
      resetLiveSequence(); rotation.current = null; setConfirm(false);
      setQuery({}); setNotice("已归档原批次，新的直播展示组为空。历史记录仍可按刷新时间查看。"); changed();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "刷新失败，请重试"); }
    finally { lock.current = false; setBusy(false); }
  };
  const removal = useRef<{ entryId: string; batchId: string; key: string } | null>(null);
  const remove = async (entryId: string) => {
    if (!result || lock.current) return;
    lock.current = true; setBusy(true);
    try {
      if (removal.current?.entryId !== entryId || removal.current?.batchId !== result.batch.id) removal.current = { entryId, batchId: result.batch.id, key: createRandomUuid() };
      await removeLiveEntry(entryId, result.batch.id, removal.current.key);
      removal.current = null; resetLiveSequence();
      setNotice("已取消直播展示并退回待分流，原留言与回复仍保留。"); changed();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "取消失败，请重试"); }
    finally { lock.current = false; setBusy(false); }
  };
  const move = async (entryId: string, position: number) => {
    if (!result || archived || liveMode || lock.current) return;
    lock.current = true; setBusy(true); setMovingId(entryId); setError(null); setNotice(null); setOrderIssue(null);
    moveRequest.current ??= { entryId, input: { batchId: result.batch.id, expectedRevision: result.batch.revision,
      position, requestKey: createRandomUuid() } };
    const request = moveRequest.current;
    const focused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    let saved = false;
    try {
      await moveLiveEntry(request.entryId, request.input);
      saved = true; resetLiveSequence();
      const destinationPage = Math.ceil(request.input.position / STUDIO_PAGE_SIZE);
      const value = await getLiveEntries(request.input.batchId, destinationPage);
      moveRequest.current = null;
      const nextQuery = new URLSearchParams(query);
      if (destinationPage === 1) nextQuery.delete("page"); else nextQuery.set("page", String(destinationPage));
      setLoaded({ key: `${batchId ?? "current"}:${destinationPage}:${liveMode}`, result: value });
      if (destinationPage !== page) setQuery(nextQuery);
      restoreOrderFocus.current = { entryId: request.entryId, element: focused?.closest(".studio-live-slot") ? focused : null };
      setNotice(`已移到第 ${request.input.position} 条。`);
    } catch (reason) {
      if (saved) moveRequest.current = null;
      setOrderIssue({ message: saved ? "顺序已保存，但列表没有刷新出来，请重新加载。"
        : reason instanceof Error ? reason.message : "保存失败，请重试",
      retry: !saved && !(reason instanceof StudioApiError && reason.status >= 400 && reason.status < 500) });
    } finally { lock.current = false; setBusy(false); setMovingId(null); }
  };
  const setFilter = (key: string, value: string) => {
    const next = new URLSearchParams(query); if (value) next.set(key, value); else next.delete(key);
    if (key === "batch") { next.delete("page"); next.delete("job"); next.delete("importPage"); setNotice(null); rotation.current = null; moveRequest.current = null; setOrderIssue(null); }
    setQuery(next);
  };
  return <div className="studio-page studio-live-display-page">
    <header className="studio-page-heading"><div><h1>直播展示</h1><p>{liveMode ? "只播放当前活动批次。" : "按序号播放，调整后自动保存；新加入的留言排在末尾。"}</p></div>
      {!liveMode && <div className="studio-list-controls"><label className="studio-topic-filter">直播批次
        <select aria-label="按直播批次筛选" disabled={busy} value={batchId ?? ""} onChange={event => setFilter("batch", event.target.value)}>
          <option value={batchId && result?.batch.id === batchId && !archived ? batchId : ""}>当前批次</option>{batches.filter(b => b.status === "archived").map(b => <option key={b.id} value={b.id}>{batchTime(b.archivedAt!)} 刷新</option>)}
        </select></label></div>}
    </header>
    {!liveMode && result && !archived && <div className="studio-list-controls studio-live-tools">
      <Button type="button" variant="secondary" disabled={controlsDisabled} onClick={() => setConfirm(true)}>刷新直播展示组</Button>
    </div>}
    {notice && <p role="status">{notice}</p>}
    {orderIssue && <div className="studio-live-order-error" role="alert"><p>{orderIssue.message}</p><div className="studio-list-controls">
      {orderIssue.retry && <Button type="button" variant="secondary" disabled={busy} onClick={() => {
        const request = moveRequest.current; if (request) void move(request.entryId, request.input.position);
      }}>重试保存</Button>}
      <Button type="button" variant="quiet" disabled={busy} onClick={() => { moveRequest.current = null; setOrderIssue(null); setLoaded(null); changed(); }}>重新加载列表</Button>
    </div></div>}
    {archived && <p role="status">已归档 · {batchTime(result!.batch.archivedAt!)} 刷新（UTC+8）。历史批次只读，不能进入当前直播。</p>}
    {error && <StudioError message={error} onRetry={() => { setError(null); changed(); }} />}
    {!result && !error && <StudioLoading label="正在加载直播批次" />}
    {result && <p className="studio-total">共 {result.total} 条</p>}
    {result?.items.length === 0 && <StudioEmpty title={archived ? "这个归档批次没有留言" : "当前直播展示组为空"} description={liveMode ? "等待工作人员从待分流加入留言，画面将自动更新。" : "请从待分流加入观众留言或已分类的 Excel 行。"} />}
    {result && !liveMode && <ol role="list" className="studio-feedback-grid studio-live-ordered-list" aria-label="直播展示顺序" start={(result.page - 1) * STUDIO_PAGE_SIZE + 1}>{result.items.map((item, index) => <li key={item.id}>
      <LiveEntryCard item={item} batchId={result.batch.id} archived={Boolean(archived)} disabled={controlsDisabled}
        expanded={expandedIds.includes(item.id)}
        onExpand={() => setExpandedState({ key: resultKey, ids: expandedIds.includes(item.id) ? expandedIds.filter(id => id !== item.id) : [...expandedIds, item.id] })}
        onOpen={(event, target, element) => openEntry(event, target, element, item.id)} onRemove={() => void remove(item.id)}>
      {archived ? <div className="studio-live-slot">
        <span className="studio-live-slot-number" aria-hidden="true">{(result.page - 1) * STUDIO_PAGE_SIZE + index + 1}</span>
        <span className="sr-only">第 {(result.page - 1) * STUDIO_PAGE_SIZE + index + 1} 条</span>
      </div>
        : <LiveOrderControl nickname={item.nickname} position={(result.page - 1) * STUDIO_PAGE_SIZE + index + 1}
          total={result.total} disabled={controlsDisabled} saving={movingId === item.id} onMove={position => void move(item.id, position)} />}
      </LiveEntryCard></li>)}</ol>}
    {!liveMode && result && result.totalPages > 1 && <nav className="studio-pagination" aria-label="直播留言分页">
      <Button type="button" variant="quiet" disabled={controlsDisabled || page <= 1} onClick={() => setFilter("page", String(page - 1))}>上一页</Button>
      <span>{page} / {result.totalPages}</span>
      <Button type="button" variant="quiet" disabled={controlsDisabled || page >= result.totalPages} onClick={() => setFilter("page", String(page + 1))}>下一页</Button>
    </nav>}
    {!liveMode && <ConfirmDialog open={confirm} title="刷新直播展示组？" description={`当前批次共 ${result?.total ?? 0} 条留言。将归档这些记录并开启空批次，直播画面会变为空。留言、回复和导入记录都不会删除。`}
      confirmLabel="归档并开启空批次" busy={busy} error={error} onCancel={() => setConfirm(false)} onConfirm={() => void rotate()} />}
  </div>;
}
