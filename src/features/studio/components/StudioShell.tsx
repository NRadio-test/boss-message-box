import {
  ArrowsOutSimple,
  Broadcast,
  CaretDown,
  CheckCircle,
  Images,
  ListChecks,
  LockKey,
  MagnifyingGlass,
  ShieldWarning,
  SignOut,
  SquaresFour,
  X,
} from "@phosphor-icons/react";
import { useCallback, useEffect, useRef, useState, type CSSProperties, type FormEvent, type ReactNode } from "react";
import { NavLink, Outlet, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { getActiveBatch, getLiveSequence } from "../live-api";
import { captureReturnContext, clearLiveReturn, loadLiveReturn, saveLiveReturn } from "../navigation-context";
import { useStudioSession } from "../use-studio-session";
import { StudioLoading } from "./AsyncState";
import { ConfirmDialog } from "./ConfirmDialog";
import { LiveBackdropControl } from "./LiveBackdropControl";
import { loadLiveBackdrop, saveLiveBackdrop, type LiveBackdrop } from "../live-backdrop";
import { LIVE_CHROME_IDLE_MS, loadLiveChrome, saveLiveChrome } from "../live-chrome";
import { resetLiveSequence } from "../live-sequence";

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
  const navigationRef = useRef<HTMLElement>(null);
  const repliedActive = location.pathname.startsWith("/studio/replied/");
  const [repliedOpen, setRepliedOpen] = useState(true);
  useEffect(() => {
    if (location.pathname === "/studio/ultra-photos") {
      navigationRef.current?.querySelector("a.active")?.scrollIntoView({ block: "nearest" });
    }
  }, [location.pathname]);
  return (
    <nav
      ref={navigationRef}
      className="studio-nav"
      aria-label="Studio 导航"
      onClick={(event) => {
        if ((event.target as HTMLElement).closest("a")) afterNavigate?.();
      }}
    >
      <span className="studio-nav-label">留言</span>
      <NavLink to="/studio/routing"><ListChecks aria-hidden="true" weight="bold" />待分流</NavLink>
      <NavLink to="/studio/unreplied"><SquaresFour aria-hidden="true" weight="bold" />未回复</NavLink>
      <NavLink to="/studio/live-display"><Broadcast aria-hidden="true" weight="bold" />直播展示</NavLink>
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
      <NavLink to="/studio/moderation"><ShieldWarning aria-hidden="true" weight="bold" />AI 待处理</NavLink>
      <span className="studio-nav-label">处理</span>
      <NavLink to="/studio/todo"><ListChecks aria-hidden="true" weight="bold" />待办</NavLink>
      <NavLink to="/studio/ultra-photos"><Images aria-hidden="true" weight="bold" />Ultra 到货照片</NavLink>
      <NavLink to="/studio/password"><LockKey aria-hidden="true" weight="bold" />修改密码</NavLink>
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
  const [liveBackdrop, setLiveBackdrop] = useState(loadLiveBackdrop);
  const [backdropSaved, setBackdropSaved] = useState(true);
  const [liveChrome, setLiveChrome] = useState(loadLiveChrome);
  const [chromeVisible, setChromeVisible] = useState(true);
  const mobileNavRef = useRef<HTMLDetailsElement>(null);
  const modeActionRef = useRef(false);
  const modeDestinationRef = useRef<string | null>(null);
  const liveExitRef = useRef(false);
  const chromeTimerRef = useRef<number | null>(null);
  const liveRequested = searchParams.get("mode") === "live";
  const photoPage = location.pathname === "/studio/ultra-photos";
  const photoLiveRequested = photoPage && liveRequested;
  const liveMode = liveRequested || mode === "live";
  const liveModeReady = photoLiveRequested || !liveRequested || mode === "live";
  const chromeHidden = liveMode && !liveChrome.pinned && !chromeVisible;

  const scheduleChromeHide = useCallback(() => {
    if (chromeTimerRef.current !== null) window.clearTimeout(chromeTimerRef.current);
    chromeTimerRef.current = window.setTimeout(() => setChromeVisible(false), LIVE_CHROME_IDLE_MS);
  }, []);

  const keepChromeVisible = useCallback(() => {
    setChromeVisible(true);
    scheduleChromeHide();
  }, [scheduleChromeHide]);

  /**
   * The control cluster sits inside the picture, so leaving it up means the capture stream
   * shows "画面 / 全屏 / 退出" over the message. It fades out when idle and comes back on any
   * pointer activity or key press — except the arrow keys, which drive the sequence and must
   * not flash the controls into the stream on every message change.
   */
  useEffect(() => {
    if (!liveMode || liveChrome.pinned) {
      if (chromeTimerRef.current !== null) {
        window.clearTimeout(chromeTimerRef.current);
        chromeTimerRef.current = null;
      }
      return undefined;
    }
    scheduleChromeHide();
    const reveal = () => keepChromeVisible();
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") return;
      keepChromeVisible();
    };
    window.addEventListener("pointermove", reveal, { passive: true });
    window.addEventListener("pointerdown", reveal, { passive: true });
    window.addEventListener("wheel", reveal, { passive: true });
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointermove", reveal);
      window.removeEventListener("pointerdown", reveal);
      window.removeEventListener("wheel", reveal);
      window.removeEventListener("keydown", onKeyDown);
      if (chromeTimerRef.current !== null) {
        window.clearTimeout(chromeTimerRef.current);
        chromeTimerRef.current = null;
      }
    };
  }, [keepChromeVisible, liveChrome.pinned, liveMode, scheduleChromeHide]);

  // The warmed sequence holds message text and image blobs; it must not outlive live mode.
  useEffect(() => {
    if (liveMode) return;
    resetLiveSequence();
  }, [liveMode]);

  useEffect(() => {
    if (modeActionRef.current) return;
    // Photo presentation shares the stage/chrome, but does not start a feedback batch.
    if (photoLiveRequested && mode === "normal") return;
    // Leaving live mode happens in two steps: navigate away, then flip the server-side mode.
    // Without this guard the effect re-adds ?mode=live during that gap, and the branch below
    // then flips the session straight back into live mode.
    if (liveExitRef.current) {
      if (mode === "normal") liveExitRef.current = false;
      return;
    }
    // Router navigation may commit after the session update. Do not rewrite the old route.
    if (modeDestinationRef.current) {
      if (location.pathname !== modeDestinationRef.current) return;
      modeDestinationRef.current = null;
    }
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
  }, [liveRequested, photoLiveRequested, location.pathname, locationState, mode, searchParams, setMode, setSearchParams]);

  const enterLiveMode = async () => {
    if (photoPage) { navigate("/studio/ultra-photos?mode=live"); return; }
    setChromeVisible(true);
    // Entering explicitly supersedes any exit that is still settling.
    liveExitRef.current = false;
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
      const view = "live_display";
      const { batch } = await getActiveBatch();
      // The live run always opens on the earliest message of the current filter and then
      // walks forward in time, so the entry point is resolved on the server rather than from
      // whichever card happened to be under the cursor.
      const start = await getLiveSequence(batch.id);
      if (start.feedbackId) {
        const next = new URLSearchParams({ mode: "live", view, batch: batch.id });
        modeDestinationRef.current = `/studio/feedback/${encodeURIComponent(start.feedbackId)}`;
        navigate(`${modeDestinationRef.current}?${next}`, {
          state: { returnContext, searchRestore: searchContext },
        });
      } else {
        navigate("/studio/live-display?mode=live", { state: locationState });
      }
    } catch (error) {
      setModeError(error instanceof Error ? error.message : "无法进入直播模式");
    } finally {
      modeActionRef.current = false;
      setModeBusy(false);
    }
  };

  const exitLiveMode = async () => {
    setChromeVisible(true);
    setModeBusy(true);
    setModeError(null);
    modeActionRef.current = true;
    liveExitRef.current = true;
    const returnContext = loadLiveReturn();
    const destination = photoPage ? "/studio/ultra-photos" : withoutLiveMode(returnContext?.url ?? "/studio/unreplied");
    try {
      if (document.fullscreenElement) await document.exitFullscreen().catch(() => undefined);
      navigate(destination, {
        replace: true,
        state: { restoreContext: returnContext, searchRestore: returnContext?.search },
      });
      if (mode !== "normal") await setMode("normal");
      clearLiveReturn();
    } catch (error) {
      // The session never flipped, so the URL has to keep tracking live mode.
      liveExitRef.current = false;
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
      resetLiveSequence();
      navigate("/studio/login", { replace: true });
    } finally {
      setLogoutBusy(false);
      setLogoutOpen(false);
    }
  };

  const changeLiveBackdrop = (value: LiveBackdrop) => {
    setLiveBackdrop(value);
    setBackdropSaved(saveLiveBackdrop(value));
  };

  const changeChromePinned = (pinned: boolean) => {
    setLiveChrome({ pinned });
    setChromeVisible(true);
    setBackdropSaved(saveLiveChrome({ pinned }));
  };

  const liveActions: ReactNode = liveMode ? (
    <div className="studio-live-actions">
      <LiveBackdropControl
        value={liveBackdrop}
        saved={backdropSaved}
        onChange={changeLiveBackdrop}
        chromePinned={liveChrome.pinned}
        onChromePinnedChange={changeChromePinned}
      />
      <button
        type="button"
        className="studio-live-action"
        aria-label="全屏展示"
        onClick={() => void document.documentElement.requestFullscreen?.().catch(() => setModeError("暂时无法全屏，请重试或使用浏览器全屏。"))}
      >
        <ArrowsOutSimple aria-hidden="true" weight="bold" /><span>全屏</span>
      </button>
      <button
        type="button"
        className="studio-live-action studio-live-exit"
        aria-label="退出直播模式"
        disabled={modeBusy}
        onClick={() => void exitLiveMode()}
      >
        <X aria-hidden="true" weight="bold" /><span>{modeBusy ? "退出中" : "退出"}</span>
      </button>
    </div>
  ) : null;

  return (
    <div
      className="studio-shell"
      data-mode={liveMode ? "live" : "normal"}
      data-chrome={liveMode ? (chromeHidden ? "hidden" : "visible") : undefined}
      data-chroma={liveMode && liveBackdrop.enabled ? "true" : undefined}
      style={liveMode && liveBackdrop.enabled ? { "--live-canvas": liveBackdrop.color } as CSSProperties : undefined}
    >
      <aside className="studio-sidebar">
        <StudioBrand />
        <StudioNavigation />
        <div className="studio-sidebar-footer">
          <button type="button" className="studio-live-toggle" disabled={modeBusy} onClick={() => void enterLiveMode()}>
            <Broadcast aria-hidden="true" weight="bold" />
            <span><strong>直播展示模式</strong><small>播放当前直播展示组</small></span>
          </button>
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
            <button type="button" className="studio-live-toggle" disabled={modeBusy} onClick={() => void enterLiveMode()}>
              <Broadcast aria-hidden="true" weight="bold" />直播展示模式
            </button>
            <button type="button" className="studio-logout-row" onClick={() => setLogoutOpen(true)}>
              <SignOut aria-hidden="true" weight="bold" />退出登录
            </button>
          </div>
        </details>
      </header>

      <div className="studio-workspace">
        <header className="studio-toolbar" onFocusCapture={keepChromeVisible}>
          <form className="studio-search" role="search" onSubmit={submitSearch}>
            <MagnifyingGlass aria-hidden="true" />
            <label className="sr-only" htmlFor="studio-search">搜索抖音昵称或留言编号</label>
            <input
              id="studio-search"
              value={search}
              maxLength={100}
              placeholder="搜索抖音昵称 / 留言编号"
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
