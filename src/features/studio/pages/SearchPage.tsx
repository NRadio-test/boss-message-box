import { ArrowLeft, ArrowRight, MagnifyingGlass } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { useLocation, useNavigate, useOutletContext } from "react-router-dom";
import type { StudioFeedbackSummary, StudioSearchSuccess, StudioSnapshot } from "../../../shared/studio-contracts";
import { searchStudioFeedbacks, updateStudioTodo } from "../api";
import { captureReturnContext, restoreListPosition, type StudioReturnContext } from "../navigation-context";
import { StudioEmpty, StudioError, StudioLoading } from "../components/AsyncState";
import { FeedbackCard } from "../components/FeedbackCard";
import type { StudioOutletContext } from "../components/StudioShell";

interface SearchLocationState {
  query?: string;
  restoreContext?: StudioReturnContext;
  searchRestore?: { query: string; page: number; snapshot?: StudioSnapshot | null };
}

const QUERY_TYPE_LABELS = {
  phone: "手机号",
  feedback_number: "留言编号",
  nickname: "抖音昵称",
  combined: "抖音昵称 / 留言编号",
} as const;

export function SearchPage() {
  const { liveMode } = useOutletContext<StudioOutletContext>();
  const location = useLocation();
  const navigate = useNavigate();
  const state = location.state as SearchLocationState | null;
  const restored = state?.searchRestore;
  const query = restored?.query ?? state?.query?.trim() ?? "";
  const restoredPage = restored?.page ?? 1;
  const [paging, setPaging] = useState({ query, page: restoredPage });
  const page = paging.query === query ? paging.page : restoredPage;
  const [loaded, setLoaded] = useState<{ query: string; page: number; value: StudioSearchSuccess } | null>(null);
  const result = loaded?.query === query && loaded.page === page ? loaded.value : null;
  const [failure, setFailure] = useState<{ query: string; page: number; message: string } | null>(null);
  const error = failure?.query === query && failure.page === page ? failure.message : null;
  const [reload, setReload] = useState(0);
  const [todoBusy, setTodoBusy] = useState<string | null>(null);
  const [snapshots, setSnapshots] = useState<Record<string, StudioSnapshot | null>>(() =>
    query ? { [query]: restored?.snapshot ?? null } : {},
  );
  const snapshot = Object.prototype.hasOwnProperty.call(snapshots, query)
    ? snapshots[query] ?? null
    : restored?.snapshot ?? null;

  useEffect(() => {
    if (!query) return;
    const controller = new AbortController();
    searchStudioFeedbacks(query, page, snapshot, controller.signal)
      .then((value) => {
        if (controller.signal.aborted) return;
        if (!snapshot) {
          setSnapshots((current) => ({ ...current, [query]: value.snapshot }));
        }
        setLoaded({ query, page, value });
        setFailure(null);
        if (state?.restoreContext) {
          requestAnimationFrame(() => restoreListPosition(state.restoreContext ?? null));
        }
      })
      .catch((reason) => {
        if (!controller.signal.aborted) {
          setFailure({
            query,
            page,
            message: reason instanceof Error ? reason.message : "搜索失败，请稍后重试",
          });
        }
      });
    return () => controller.abort();
  }, [liveMode, page, query, reload, snapshot, state?.restoreContext]);

  const toggleTodo = async (item: StudioFeedbackSummary) => {
    setTodoBusy(item.id);
    try {
      const value = await updateStudioTodo(item.id, !item.isTodo);
      setLoaded((current) => current ? {
        ...current,
        value: {
          ...current.value,
          items: current.value.items.map((candidate) => candidate.id === item.id ? { ...candidate, isTodo: value.isTodo } : candidate),
        },
      } : current);
    } catch (reason) {
      setFailure({ query, page, message: reason instanceof Error ? reason.message : "待办状态更新失败" });
    } finally {
      setTodoBusy(null);
    }
  };

  const orderedIds = result?.items.map((item) => item.id) ?? [];
  const currentUrl = `${location.pathname}${location.search}`;
  const changePage = (nextPage: number) => {
    setPaging({ query, page: nextPage });
    navigate(currentUrl, {
      replace: true,
      state: {
        query,
        searchRestore: { query, page: nextPage, snapshot: result?.snapshot ?? snapshot },
      },
    });
  };
  return (
    <div className="studio-page">
      <header className="studio-page-heading">
        <div><span className="studio-kicker">统一搜索</span><h1>搜索结果</h1><p>按抖音昵称或留言编号查找，纯数字昵称也可以搜索。</p></div>
        {result && <span className="studio-total">共 {result.pagination.total} 条</span>}
      </header>

      {!query && <StudioEmpty title="输入要查找的内容" description="使用页面上方搜索框开始查询。" />}
      {query && !result && !error && <StudioLoading label="正在搜索留言" />}
      {error && <StudioError message={error} onRetry={() => { setFailure(null); setReload((value) => value + 1); }} />}
      {result && (
        <>
          <div className="studio-search-summary">
            <MagnifyingGlass aria-hidden="true" />
            <span>按{QUERY_TYPE_LABELS[result.queryType]}搜索</span>
            <strong>{query}</strong>
          </div>
          {result.items.length === 0 ? (
            <StudioEmpty title="没有找到匹配留言" description="请检查输入内容后重新搜索。" />
          ) : (
            <div className="studio-feedback-grid">
              {result.items.map((item) => (
                <FeedbackCard
                  key={item.id}
                  item={item}
                  liveMode={liveMode}
                  todoBusy={todoBusy === item.id}
                  onTodoChange={(selected) => void toggleTodo(selected)}
                  returnContext={{
                    ...captureReturnContext(
                      currentUrl,
                      item.id,
                      orderedIds,
                      document.querySelector<HTMLElement>(`[data-feedback-id="${CSS.escape(item.id)}"]`),
                    ),
                    search: { query, page, snapshot: result.snapshot },
                  }}
                />
              ))}
            </div>
          )}
          {result.pagination.totalPages > 1 && (
            <nav className="studio-pagination" aria-label="搜索结果分页">
              {page > 1 ? <button type="button" onClick={() => changePage(page - 1)}><ArrowLeft aria-hidden="true" />上一页</button> : <span />}
              <span>第 {page} / {result.pagination.totalPages} 页</span>
              {page < result.pagination.totalPages ? <button type="button" onClick={() => changePage(page + 1)}>下一页<ArrowRight aria-hidden="true" /></button> : <span />}
            </nav>
          )}
        </>
      )}
    </div>
  );
}
