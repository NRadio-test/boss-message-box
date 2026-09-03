import { ArrowLeft, ArrowRight, BellSimple } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useOutletContext, useSearchParams } from "react-router-dom";
import type {
  StudioFeedbackListSuccess,
  StudioFeedbackSummary,
  StudioFeedbackView,
  StudioSnapshot,
} from "../../../shared/studio-contracts";
import { getNewStudioFeedbackCount, getStudioFeedbacks, updateStudioTodo } from "../api";
import { captureReturnContext, restoreListPosition, type StudioReturnContext } from "../navigation-context";
import { StudioEmpty, StudioError, StudioLoading } from "../components/AsyncState";
import { FeedbackCard } from "../components/FeedbackCard";
import type { StudioOutletContext } from "../components/StudioShell";
import { StudioStats } from "../components/StudioStats";

const VIEW_COPY: Record<StudioFeedbackView, { title: string; description: string; empty: string }> = {
  unreplied: { title: "未回复留言", description: "最新提交排在最前，每页显示 30 条。", empty: "目前没有等待回复的留言。" },
  replied: { title: "全部已回复", description: "查看所有至少有一条回复的留言。", empty: "目前还没有已回复留言。" },
  live: { title: "直播回复", description: "包含至少一条直播回复的留言。", empty: "目前还没有直播回复。" },
  message: { title: "留言回复", description: "包含至少一条留言回复的留言。", empty: "目前还没有留言回复。" },
  todo: { title: "待办", description: "按留言原始提交时间从新到旧排列。", empty: "待办已经处理完了。" },
};

interface ListLocationState {
  restoreContext?: StudioReturnContext;
}

export function FeedbackListPage({ view }: { view: StudioFeedbackView }) {
  const { liveMode } = useOutletContext<StudioOutletContext>();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedPage = Number(searchParams.get("page") ?? "1");
  const page = Number.isSafeInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
  const [result, setResult] = useState<StudioFeedbackListSuccess | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [todoBusy, setTodoBusy] = useState<string | null>(null);
  const [newCount, setNewCount] = useState(0);
  const [snapshot, setSnapshot] = useState<StudioSnapshot | null>(null);
  const scrollAfterLoad = useRef(false);
  const restoreContext = (location.state as ListLocationState | null)?.restoreContext ?? null;
  const restoredRef = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    setError(null);
    getStudioFeedbacks(view, page, controller.signal)
      .then((value) => {
        setResult(value);
        setSnapshot((current) => current ?? value.snapshot);
        if (scrollAfterLoad.current) {
          scrollAfterLoad.current = false;
          requestAnimationFrame(() => document.getElementById("studio-list-heading")?.scrollIntoView());
        } else if (!restoredRef.current && restoreContext) {
          restoredRef.current = true;
          requestAnimationFrame(() => restoreListPosition(restoreContext));
        }
      })
      .catch((reason) => {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "留言列表加载失败");
      });
    return () => controller.abort();
  }, [page, reload, restoreContext, view]);

  useEffect(() => {
    if (view !== "unreplied" || !snapshot) return;
    let controller: AbortController | null = null;
    const poll = () => {
      if (document.visibilityState !== "visible") return;
      controller?.abort();
      controller = new AbortController();
      void getNewStudioFeedbackCount(snapshot, controller.signal)
        .then((value) => setNewCount(value.count))
        .catch(() => undefined);
    };
    const interval = window.setInterval(poll, 20_000);
    return () => {
      window.clearInterval(interval);
      controller?.abort();
    };
  }, [snapshot, view]);

  const changePageUrl = (nextPage: number) => {
    const next = new URLSearchParams(searchParams);
    if (nextPage === 1) next.delete("page");
    else next.set("page", String(nextPage));
    return `${location.pathname}${next.size ? `?${next}` : ""}`;
  };

  const showNewest = () => {
    scrollAfterLoad.current = true;
    setNewCount(0);
    setSnapshot(null);
    if (page === 1) setReload((value) => value + 1);
    else {
      const next = new URLSearchParams(searchParams);
      next.delete("page");
      setSearchParams(next);
    }
  };

  const toggleTodo = async (item: StudioFeedbackSummary) => {
    setTodoBusy(item.id);
    try {
      const value = await updateStudioTodo(item.id, !item.isTodo);
      setResult((current) => current ? {
        ...current,
        items:
          view === "todo" && !value.isTodo
            ? current.items.filter((candidate) => candidate.id !== item.id)
            : current.items.map((candidate) => candidate.id === item.id ? { ...candidate, isTodo: value.isTodo } : candidate),
      } : current);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "待办状态更新失败");
    } finally {
      setTodoBusy(null);
    }
  };

  const copy = VIEW_COPY[view];
  const orderedIds = result?.items.map((item) => item.id) ?? [];
  const currentUrl = `${location.pathname}${location.search}`;

  return (
    <div className="studio-page">
      {!liveMode && <StudioStats />}
      <header className="studio-page-heading" id="studio-list-heading">
        <div><span className="studio-kicker">留言工作台</span><h1>{copy.title}</h1><p>{copy.description}</p></div>
        {result && <span className="studio-total">共 {result.pagination.total} 条</span>}
      </header>

      {newCount > 0 && (
        <div className="studio-new-feedback" role="status">
          <BellSimple aria-hidden="true" weight="fill" />
          <span>有 {newCount} 条新留言</span>
          <button type="button" onClick={showNewest}>查看</button>
        </div>
      )}

      {error && <StudioError message={error} onRetry={() => setReload((value) => value + 1)} />}
      {!error && !result && <StudioLoading label="正在加载留言" />}
      {!error && result?.items.length === 0 && <StudioEmpty title="这里暂时是空的" description={copy.empty} />}
      {!error && result && result.items.length > 0 && (
        <div className="studio-feedback-grid">
          {result.items.map((item) => (
            <FeedbackCard
              key={item.id}
              item={item}
              liveMode={liveMode}
              todoBusy={todoBusy === item.id}
              onTodoChange={(selected) => void toggleTodo(selected)}
              returnContext={captureReturnContext(
                currentUrl,
                item.id,
                orderedIds,
                document.querySelector<HTMLElement>(`[data-feedback-id="${CSS.escape(item.id)}"]`),
              )}
            />
          ))}
        </div>
      )}

      {result && result.pagination.totalPages > 1 && (
        <nav className="studio-pagination" aria-label="留言分页">
          {page > 1 ? <Link to={changePageUrl(page - 1)}><ArrowLeft aria-hidden="true" />上一页</Link> : <span />}
          <span>第 {page} / {result.pagination.totalPages} 页</span>
          {page < result.pagination.totalPages ? <Link to={changePageUrl(page + 1)}>下一页<ArrowRight aria-hidden="true" /></Link> : <span />}
        </nav>
      )}
    </div>
  );
}
