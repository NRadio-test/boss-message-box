import {
  Broadcast,
  CaretDown,
  CheckCircle,
  ListChecks,
  MagnifyingGlass,
  ShieldWarning,
  SignOut,
  SquaresFour,
  X,
} from "@phosphor-icons/react";
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { NavLink, Outlet, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { Button } from "../../../components/Button";
import { captureReturnContext, clearLiveReturn, loadLiveReturn, saveLiveReturn } from "../navigation-context";
import { useStudioSession } from "../use-studio-session";
import { StudioLoading } from "./AsyncState";
import { ConfirmDialog } from "./ConfirmDialog";

export interface StudioOutletContext {
  liveMode: boolean;
}

function StudioBrand() {
  return (
    <div className="studio-brand" aria-label="张导请回答 Studio">
      <span className="brand-signal" aria-hidden="true"><i /><i /><i /></span>
      <span><strong>张导请回答</strong><small>Studio</small></span>
    </div>
  );
}

function StudioNavigation({ afterNavigate }: { afterNavigate?: () => void }) {
  const location = useLocation();
  const repliedActive = location.pathname.startsWith("/studio/replied/");
  const [repliedOpen, setRepliedOpen] = useState(true);
  return (
    <nav
      className="studio-nav"
      aria-label="Studio 导航"
      onClick={(event) => {
        if ((event.target as HTMLElement).closest("a")) afterNavigate?.();
      }}
    >
      <span className="studio-nav-label">留言</span>
      <NavLink to="/studio/unreplied"><SquaresFour aria-hidden="true" weight="bold" />未回复</NavLink>
      <details
        className="studio-nav-group"
        open={repliedOpen}
        onToggle={(event) => setRepliedOpen(event.currentTarget.open)}
      >
        <summary className={repliedActive ? "active" : undefined}>
          <CheckCircle aria-hidden="true" weight="bold" />
          <span>已回复</span>
          <CaretDown className="studio-nav-caret" aria-hidden="true" weight="bold" />
        </summary>
        <div className="studio-subnav">
          <NavLink to="/studio/replied/all">全部已回复</NavLink>
          <NavLink to="/studio/replied/live">直播回复</NavLink>
          <NavLink to="/studio/replied/message">留言回复</NavLink>
        </div>
      </details>
      <NavLink to="/studio/filtered"><ShieldWarning aria-hidden="true" weight="bold" />AI 已过滤</NavLink>
      <span className="studio-nav-label">处理</span>
      <NavLink to="/studio/todo"><ListChecks aria-hidden="true" weight="bold" />待办</NavLink>
    </nav>
  );
}

function withoutLiveMode(url: string): string {
  const parsed = new URL(url, window.location.origin);
  parsed.searchParams.delete("mode");
  return `${parsed.pathname}${parsed.search}${parsed.hash}`;
}

export function StudioShell() {
  const { admin, mode, logout, setMode } = useStudioSession();
  const navigate = useNavigate();
  const location = useLocation();
  const locationState = location.state;
  const [searchParams, setSearchParams] = useSearchParams();
  const [search, setSearch] = useState("");
  const [logoutOpen, setLogoutOpen] = useState(false);
  const [logoutBusy, setLogoutBusy] = useState(false);
  const [modeBusy, setModeBusy] = useState(false);
  const [modeError, setModeError] = useState<string | null>(null);
  const mobileNavRef = useRef<HTMLDetailsElement>(null);
  const modeActionRef = useRef(false);
  const liveRequested = searchParams.get("mode") === "live";
  const liveMode = liveRequested || mode === "live";
  const liveModeReady = !liveRequested || mode === "live";
  const liveEntryAvailable =
    location.pathname === "/studio/unreplied" || location.pathname === "/studio/todo";

  useEffect(() => {
    if (modeActionRef.current) return;
    if (mode === "normal" && liveRequested) {
      const synchronizeLiveMode = async () => {
        setModeBusy(true);
        try {
          await setMode("live");
        } catch (error) {
          setModeError(error instanceof Error ? error.message : "无法进入直播模式");
        } finally {
          setModeBusy(false);
        }
      };
      void synchronizeLiveMode();
    } else if (mode === "live" && !liveRequested) {
      const next = new URLSearchParams(searchParams);
      next.set("mode", "live");
      setSearchParams(next, { replace: true, state: locationState });
    }
  }, [liveRequested, locationState, mode, searchParams, setMode, setSearchParams]);

  const enterLiveMode = async () => {
    const cards = Array.from(document.querySelectorAll<HTMLElement>("[data-feedback-id]"));
    const anchor = cards
      .map((element) => ({ element, distance: Math.abs(element.getBoundingClientRect().top) }))
      .sort((left, right) => left.distance - right.distance)[0]?.element;
    const anchorId = anchor?.dataset.feedbackId;
    const searchState = locationState as { query?: string; searchRestore?: { query: string; page: number } } | null;
    const searchContext = searchState?.searchRestore ?? (searchState?.query ? { query: searchState.query, page: 1 } : undefined);
    const returnContext = anchor && anchorId
        ? captureReturnContext(
            `${location.pathname}${location.search}`,
            anchorId,
            cards.map((element) => element.dataset.feedbackId).filter(Boolean) as string[],
            anchor,
          )
        : { url: `${location.pathname}${location.search}` };
    saveLiveReturn({ ...returnContext, ...(searchContext ? { search: searchContext } : {}) });
    setModeBusy(true);
    setModeError(null);
    modeActionRef.current = true;
    try {
      await setMode("live");
      const next = new URLSearchParams(searchParams);
      next.set("mode", "live");
      setSearchParams(next, { state: locationState });
    } catch (error) {
      setModeError(error instanceof Error ? error.message : "无法进入直播模式");
    } finally {
      modeActionRef.current = false;
      setModeBusy(false);
    }
  };

  const exitLiveMode = async () => {
    setModeBusy(true);
    setModeError(null);
    modeActionRef.current = true;
    const returnContext = loadLiveReturn();
    const destination = withoutLiveMode(returnContext?.url ?? "/studio/unreplied");
    try {
      if (document.fullscreenElement) await document.exitFullscreen().catch(() => undefined);
      navigate(destination, {
        replace: true,
        state: { restoreContext: returnContext, searchRestore: returnContext?.search },
      });
      await setMode("normal");
      clearLiveReturn();
    } catch (error) {
      setModeError(error instanceof Error ? error.message : "无法退出直播模式");
    } finally {
      modeActionRef.current = false;
      setModeBusy(false);
    }
  };

  const submitSearch = (event: FormEvent) => {
    event.preventDefault();
    const query = search.trim();
    if (!query) return;
    navigate(`/studio/search${liveMode ? "?mode=live" : ""}`, { state: { query } });
    setSearch("");
  };

  const confirmLogout = async () => {
    setLogoutBusy(true);
    try {
      await logout();
      clearLiveReturn();
      navigate("/studio/login", { replace: true });
    } finally {
      setLogoutBusy(false);
      setLogoutOpen(false);
    }
  };

  const liveActions: ReactNode = liveMode ? (
    <div className="studio-live-actions">
      <button
        type="button"
        className="studio-toolbar-button"
        onClick={() => void document.documentElement.requestFullscreen?.()}
      >
        <Broadcast aria-hidden="true" weight="bold" />全屏展示
      </button>
      <Button type="button" variant="secondary" loading={modeBusy} onClick={() => void exitLiveMode()}>
        退出直播模式
      </Button>
    </div>
  ) : null;

  return (
    <div className="studio-shell" data-mode={liveMode ? "live" : "normal"}>
      <aside className="studio-sidebar">
        <StudioBrand />
        <StudioNavigation />
        <div className="studio-sidebar-footer">
          {liveEntryAvailable && (
            <button type="button" className="studio-live-toggle" disabled={modeBusy} onClick={() => void enterLiveMode()}>
              <Broadcast aria-hidden="true" weight="bold" />
              <span><strong>直播展示模式</strong><small>聚焦留言与现场回复</small></span>
            </button>
          )}
          <div className="studio-admin-row">
            <span><small>当前账号</small><strong>{admin?.username}</strong></span>
            <button type="button" className="studio-icon-button" aria-label="退出登录" onClick={() => setLogoutOpen(true)}>
              <SignOut aria-hidden="true" weight="bold" />
            </button>
          </div>
        </div>
      </aside>

      <header className="studio-mobile-header">
        <StudioBrand />
        <details ref={mobileNavRef} className="studio-mobile-menu">
          <summary><span>导航</span><CaretDown aria-hidden="true" weight="bold" /></summary>
          <div className="studio-mobile-menu-panel">
            <StudioNavigation afterNavigate={() => mobileNavRef.current?.removeAttribute("open")} />
            {liveEntryAvailable && (
              <button type="button" className="studio-live-toggle" disabled={modeBusy} onClick={() => void enterLiveMode()}>
                <Broadcast aria-hidden="true" weight="bold" />直播展示模式
              </button>
            )}
            <button type="button" className="studio-logout-row" onClick={() => setLogoutOpen(true)}>
              <SignOut aria-hidden="true" weight="bold" />退出登录
            </button>
          </div>
        </details>
      </header>

      <div className="studio-workspace">
        <header className="studio-toolbar">
          <form className="studio-search" role="search" onSubmit={submitSearch}>
            <MagnifyingGlass aria-hidden="true" />
            <label className="sr-only" htmlFor="studio-search">搜索抖音昵称、留言编号或旧手机号</label>
            <input
              id="studio-search"
              value={search}
              maxLength={100}
              placeholder="搜索抖音昵称 / 留言编号（兼容旧手机号）"
              onChange={(event) => setSearch(event.target.value)}
            />
            <button type="submit">搜索</button>
          </form>
          {liveActions}
        </header>
        {modeBusy && <div className="studio-mode-note" aria-live="polite">正在切换展示模式…</div>}
        {modeError && <div className="studio-mode-error" role="alert"><span>{modeError}</span><button type="button" aria-label="关闭提示" onClick={() => setModeError(null)}><X aria-hidden="true" /></button></div>}
        <main id="main-content" tabIndex={-1}>
          {!liveModeReady || modeBusy ? (
            <StudioLoading label="正在切换展示模式" />
          ) : (
            <Outlet context={{ liveMode } satisfies StudioOutletContext} />
          )}
        </main>
      </div>

      <ConfirmDialog
        open={logoutOpen}
        title="确定退出登录吗？"
        confirmLabel="退出"
        busy={logoutBusy}
        danger
        onCancel={() => setLogoutOpen(false)}
        onConfirm={() => void confirmLogout()}
      />
    </div>
  );
}
