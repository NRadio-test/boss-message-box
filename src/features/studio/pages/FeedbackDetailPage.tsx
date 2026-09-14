import {
  ArrowLeft,
  ArrowRight,
  CheckCircle,
  Clock,
  Eye,
  ImageSquare,
  PaperPlaneTilt,
  ShieldWarning,
  UserCircle,
} from "@phosphor-icons/react";
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Link, Navigate, useLocation, useNavigate, useOutletContext, useParams } from "react-router-dom";
import { Button } from "../../../components/Button";
import { createRandomUuid } from "../../../lib/random-id";
import { TOPIC_LABELS, TOPIC_VALUES, type Topic } from "../../../shared/contracts";
import { studioFeedbackViewSchema, type StudioFeedbackDetail, type StudioReplyType } from "../../../shared/studio-contracts";
import {
  createStudioReply,
  deleteStudioReply,
  getStudioFeedback,
  revealStudioPhone,
  retryStudioModeration,
  StudioApiError,
  updateStudioModeration,
} from "../api";
import type { StudioReturnContext } from "../navigation-context";
import { StudioError, StudioLoading } from "../components/AsyncState";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { Lightbox, type LightboxImage } from "../components/Lightbox";
import type { StudioOutletContext } from "../components/StudioShell";
import { readLiveImage } from "../live-images";
import {
  invalidateLiveFeedback,
  loadLiveFeedback,
  loadLiveNeighbor,
  readLiveFeedback,
  readLiveNeighbor,
  warmLiveSequence,
  resetLiveSequence,
} from "../live-sequence";
import { getActiveBatch } from "../live-api";
import { LiveMessageText } from "../components/LiveMessageText";
import { ReplyHistory } from "../components/ReplyHistory";
import { LiveSelectionControl } from "../components/LiveSelectionControl";

function formatDate(timestamp: number): string {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(timestamp));
}

interface DetailLocationState {
  returnContext?: StudioReturnContext;
  instantEntry?: boolean;
}

interface ReplyAttempt {
  feedbackId: string;
  content: string;
  replyType?: StudioReplyType;
  requestKey: string;
}

type StepDirection = "previous" | "next";

type StepOutcome =
  | { status: "moved"; feedbackId: string }
  | { status: "end" }
  | { status: "failed"; message: string };

interface StepCopy {
  switching: string;
  end: string;
  failure: string;
}

/**
 * Live mode plays the queue oldest-first, so there "next" moves forward in time; the normal
 * detail page keeps following the newest-first list, where "next" means the older entry.
 * Direction names are therefore only meaningful together with the mode.
 */
function stepCopy(liveMode: boolean, direction: StepDirection): StepCopy {
  if (liveMode) {
    return direction === "next"
      ? { switching: "正在切换到更新的一条…", end: "已经是最新的一条留言了", failure: "更新的一条留言暂时无法加载" }
      : { switching: "正在切换到更早的一条…", end: "已经是第一条留言了", failure: "更早的一条留言暂时无法加载" };
  }
  return direction === "next"
    ? { switching: "正在切换到下一条留言…", end: "已经是最后一条留言了", failure: "下一条留言暂时无法加载" }
    : { switching: "正在切换到上一条留言…", end: "已经是第一条留言了", failure: "上一条留言暂时无法加载" };
}

/** Steps that follow each other faster than this are treated as one continuous skim. */
const RAPID_STEP_MS = 900;
/** A burst of queued steps is capped so a stuck key cannot run through the whole queue. */
const MAX_QUEUED_STEPS = 8;
/** How long a state notice stays on the live stage before it clears itself. */
const LIVE_NOTICE_MS = 4000;

export function FeedbackDetailPage() {
  const { feedbackId = "" } = useParams();
  const { liveMode } = useOutletContext<StudioOutletContext>();
  const location = useLocation();
  const batchId = liveMode ? new URLSearchParams(location.search).get("batch") ?? undefined : undefined;
  const navigate = useNavigate();
  const locationState = location.state as DetailLocationState | null;
  const returnContext = locationState?.returnContext ?? null;
  const instantEntry = locationState?.instantEntry === true;
  const [loaded, setLoaded] = useState<{ feedbackId: string; batchId?: string; item: StudioFeedbackDetail } | null>(null);
  const stateItem = loaded?.feedbackId === feedbackId && loaded.batchId === batchId ? loaded.item : null;
  // Reading the warmed cache during render keeps a prefetched message on screen without a
  // loading frame, which is the point of preparing the sequence ahead of the operator.
  const item = stateItem ?? (liveMode ? readLiveFeedback(feedbackId, batchId) : null);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [revealedPhone, setRevealedPhone] = useState<{ userId: string; phone: string } | null>(null);
  const [revealing, setRevealing] = useState(false);
  const [replyType, setReplyType] = useState<StudioReplyType | null>(null);
  const [replyContent, setReplyContent] = useState("");
  const [replyError, setReplyError] = useState<string | null>(null);
  const [replyPending, setReplyPending] = useState(false);
  const [replySubmitted, setReplySubmitted] = useState(false);
  const [moderationNotice, setModerationNotice] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [deletingReply, setDeletingReply] = useState(false);
  const [moderationBusy, setModerationBusy] = useState(false);
  const [liveSelectionPending, setLiveSelectionPending] = useState(false);
  const [navigationDirection, setNavigationDirection] = useState<StepDirection | null>(null);
  const navigationBusy = navigationDirection !== null;
  const [atEnd, setAtEnd] = useState(false);
  const [liveNotice, setLiveNotice] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const replyRef = useRef<HTMLTextAreaElement>(null);
  const actionRef = useRef(false);
  const replyAttemptRef = useRef<ReplyAttempt | null>(null);
  const currentFeedbackRef = useRef(feedbackId);
  /**
   * Where the arrow keys are stepping from. A warmed step can finish before React commits the
   * navigation, so the committed id is not a safe cursor: this one is advanced synchronously
   * when a step navigates, and re-synced whenever a message actually commits.
   */
  const liveCursorRef = useRef(feedbackId);
  const stepRef = useRef(false);
  const queueRef = useRef<{ direction: StepDirection; steps: number } | null>(null);
  const lastStepAtRef = useRef(0);

  const sequence = useMemo(() => {
    const query = new URLSearchParams(location.search);
    const parsed = studioFeedbackViewSchema.safeParse(query.get("view"));
    const topicValue = query.get("topic");
    return {
      view: parsed.success ? parsed.data : "unreplied" as const,
      topic: topicValue && TOPIC_VALUES.includes(topicValue as Topic) ? topicValue as Topic : null,
    };
  }, [location.search]);

  useEffect(() => {
    if (liveMode) resetLiveSequence();
  }, [batchId, liveMode]);

  useEffect(() => {
    if (!liveMode || !batchId) return;
    const controller = new AbortController();
    let revision: number | undefined;
    const check = async () => {
      try {
        const { batch } = await getActiveBatch(controller.signal);
        if (!controller.signal.aborted && batch.id !== batchId) {
          resetLiveSequence(); setLoaded(null); queueRef.current = null;
          navigate("/studio/live-display?mode=live", { replace: true });
        } else if (!controller.signal.aborted) {
          if (revision !== undefined && revision !== batch.revision) {
            resetLiveSequence(); queueRef.current = null;
            setReload(value => value + 1);
          }
          revision = batch.revision;
        }
      } catch { /* Read errors do not silently select an old or different batch. */ }
    };
    const timer = window.setInterval(() => void check(), 4000);
    window.addEventListener("studio:batch-changed", check);
    void check();
    return () => { controller.abort(); window.clearInterval(timer); window.removeEventListener("studio:batch-changed", check); };
  }, [batchId, liveMode, navigate]);

  useEffect(() => {
    liveCursorRef.current = feedbackId;
    if (currentFeedbackRef.current !== feedbackId) {
      currentFeedbackRef.current = feedbackId;
      replyAttemptRef.current = null;
      setReplyPending(false);
      setReplySubmitted(false);
      setAtEnd(false);
      // The stage notice is deliberately left alone: a queued step can resolve before React
      // commits the previous navigation, and clearing it here would swallow the boundary
      // message the operator just triggered. It clears itself on the next successful step.
      setModerationNotice(null);
      setLiveSelectionPending(false);
      setReplyContent("");
      setReplyType(null);
      setReplyError(null);
    }
    if (liveMode) {
      if (!batchId) return;
      // Served from the prefetched window when possible; otherwise the load is deduplicated
      // against any identical request already in flight.
      let cancelled = false;
      loadLiveFeedback(feedbackId, batchId)
        .then((value) => {
          if (cancelled) return;
          setLoaded({ feedbackId, batchId, item: value });
          setError(null);
        })
        .catch((reason) => {
          if (!cancelled) setError(reason instanceof Error ? reason.message : "留言详情加载失败");
        });
      return () => {
        cancelled = true;
      };
    }
    const controller = new AbortController();
    getStudioFeedback(feedbackId, controller.signal)
      .then((value) => {
        if (controller.signal.aborted) return;
        setLoaded({ feedbackId, item: value.item });
        setError(null);
      })
      .catch((reason) => {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "留言详情加载失败");
      });
    return () => controller.abort();
  }, [batchId, feedbackId, liveMode, reload]);

  // Warm both neighbours as soon as a message is on screen: their ids, their details and
  // their images. Everything is deduplicated inside the cache, so repeating this is cheap.
  useEffect(() => {
    if (!liveMode || !item) return undefined;
    const timer = window.setTimeout(() => {
      warmLiveSequence({ id: item.id, view: sequence.view, topic: sequence.topic, batchId });
    }, 120);
    return () => window.clearTimeout(timer);
  }, [batchId, item, liveMode, sequence.topic, sequence.view]);

  useEffect(() => {
    if (!liveNotice) return undefined;
    const timer = window.setTimeout(() => setLiveNotice(null), LIVE_NOTICE_MS);
    return () => window.clearTimeout(timer);
  }, [liveNotice]);

  const images = useMemo<LightboxImage[]>(
    () => item?.images.map((image, index) => ({
      id: image.id,
      src: readLiveImage(image.viewUrl) ?? image.viewUrl,
      downloadUrl: image.downloadUrl,
      alt: `留言图片 ${index + 1}`,
      width: image.width,
      height: image.height,
    })) ?? [],
    [item],
  );

  const goBack = () => {
    const destination = returnContext?.url ?? `/studio/unreplied${liveMode ? "?mode=live" : ""}`;
    navigate(destination, {
      state: {
        restoreContext: returnContext,
        searchRestore: returnContext?.search,
      },
    });
  };

  const revealPhone = async () => {
    const fullPhone = !liveMode && revealedPhone && revealedPhone.userId === item?.userId ? revealedPhone.phone : null;
    if (!item?.userId || liveMode || revealing || fullPhone) return;
    setRevealing(true);
    setReplyError(null);
    try {
      setRevealedPhone({ userId: item.userId, phone: (await revealStudioPhone(item.userId)).phone });
    } catch (reason) {
      setReplyError(reason instanceof Error ? reason.message : "手机号暂时无法显示");
    } finally {
      setRevealing(false);
    }
  };

  const revealWithKeyboard = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    void revealPhone();
  };

  const validateReply = (): boolean => {
    const content = replyContent.trim();
    if (!content) {
      setReplyError("请填写回复内容");
      replyRef.current?.focus();
      return false;
    }
    if (content.length > 2000) {
      setReplyError("回复内容不能超过 2000 个字符");
      replyRef.current?.focus();
      return false;
    }
    if (!replyType) {
      setReplyError("请选择直播回复或留言回复");
      return false;
    }
    setReplyError(null);
    return true;
  };

  const submitReply = async () => {
    if (liveMode || !item || actionRef.current || liveSelectionPending || !validateReply()) return;
    actionRef.current = true;
    setSubmitting(true);
    try {
      await saveReply(replyContent.trim(), replyType ?? undefined);
      setReplyType(null);
      setConfirmOpen(false);
    } catch (reason) {
      setReplyError(reason instanceof Error ? reason.message : "回复提交失败，请稍后重试");
    } finally {
      actionRef.current = false;
      setSubmitting(false);
    }
  };

  const applyReply = (value: Awaited<ReturnType<typeof createStudioReply>>) => {
    setLoaded((current) => current?.feedbackId === feedbackId ? {
      feedbackId,
      item: {
        ...current.item,
        replies: current.item.replies.some((reply) => reply.id === value.reply.id)
          ? current.item.replies
          : [...current.item.replies, value.reply],
        status: current.item.moderationStatus === "filtered" ? "filtered" : value.status,
        isTodo: value.isTodo,
        replyCount: value.replyCount,
        latestReplyAdmin: value.latestReplyAdmin,
        moderationStatus: current.item.moderationStatus === "pending" ? "kept" : current.item.moderationStatus,
      },
    } : current);
  };

  const saveReply = async (content: string, type?: StudioReplyType) => {
    const attempt = replyAttemptRef.current ?? {
      feedbackId,
      content,
      replyType: type,
      requestKey: createRandomUuid(),
    };
    replyAttemptRef.current = attempt;
    setReplyPending(true);
    try {
      const value = await createStudioReply(attempt.feedbackId, attempt.content, attempt.replyType, attempt.requestKey);
      applyReply(value);
      setReplySubmitted(true);
      replyAttemptRef.current = null;
      setReplyPending(false);
      setReplyContent("");
    } catch (reason) {
      // A rejected request may be edited; uncertain outcomes must retry the same operation.
      if (reason instanceof StudioApiError && reason.status >= 400 && reason.status < 500) {
        replyAttemptRef.current = null;
        setReplyPending(false);
      }
      throw reason;
    }
  };

  const deleteReply = async (replyId: string) => {
    if (liveMode || actionRef.current || moderationBusy || liveSelectionPending) throw new Error("请等待当前操作完成后重试");
    actionRef.current = true;
    setDeletingReply(true);
    try {
      const result = await deleteStudioReply(feedbackId, replyId);
      setLoaded(current => current?.feedbackId === feedbackId ? { feedbackId, item: result.item } : current);
      if (currentFeedbackRef.current === feedbackId) setReplySubmitted(false);
      invalidateLiveFeedback(feedbackId);
    } finally {
      actionRef.current = false;
      setDeletingReply(false);
    }
  };

  const retryModeration = async () => {
    if (!item || liveMode || moderationBusy || actionRef.current || liveSelectionPending) return;
    setModerationBusy(true);
    setReplyError(null);
    try {
      await retryStudioModeration(item.id);
      setModerationNotice("已重新提交 AI 筛选");
      setReload((value) => value + 1);
    } catch (reason) {
      setReplyError(reason instanceof Error ? reason.message : "暂时无法重新筛选");
    } finally {
      setModerationBusy(false);
    }
  };

  const setFiltered = async (filtered: boolean) => {
    if (!item || liveMode || moderationBusy || actionRef.current || liveSelectionPending) return;
    setModerationBusy(true);
    setReplyError(null);
    try {
      const result = await updateStudioModeration(item.id, filtered);
      setLoaded((current) => current?.feedbackId === feedbackId ? {
        feedbackId,
        item: {
          ...current.item,
          moderationStatus: result.moderationStatus,
          moderationCategory: null,
          moderationReason: filtered ? "manual_filter" : "manual_restore",
          isTodo: false,
          liveSelected: false,
          routingStatus: "pending",
          status: filtered
            ? "filtered"
            : current.item.replyCount > 0 ? "replied" : "unreplied",
        },
      } : current);
    } catch (reason) {
      setReplyError(reason instanceof Error ? reason.message : "过滤状态更新失败");
    } finally {
      setModerationBusy(false);
    }
  };

  const stepOnce = useCallback(async (fromId: string, direction: StepDirection): Promise<StepOutcome> => {
    const { view, topic } = sequence;
    // Only advertise a wait when the neighbour genuinely has to be fetched; a warmed step
    // is synchronous, and flashing "正在切换…" on it would be noise on the stream.
    if (liveMode && readLiveNeighbor({ id: fromId, view, topic, direction, batchId }) === undefined) {
      setLiveNotice(stepCopy(liveMode, direction).switching);
    }
    try {
      const adjacentId = await loadLiveNeighbor({ id: fromId, view, topic, direction, batchId });
      if (!adjacentId) return { status: "end" };
      const nextQuery = new URLSearchParams({ view });
      if (liveMode) nextQuery.set("mode", "live");
      if (batchId) nextQuery.set("batch", batchId);
      if (topic) nextQuery.set("topic", topic);
      const now = Date.now();
      navigate(`/studio/feedback/${encodeURIComponent(adjacentId)}?${nextQuery}`, {
        replace: true,
        state: {
          returnContext,
          // A skim must not replay the 640ms entrance on every step.
          instantEntry: now - lastStepAtRef.current < RAPID_STEP_MS,
        },
      });
      lastStepAtRef.current = now;
      liveCursorRef.current = adjacentId;
      window.scrollTo({ top: 0, behavior: "instant" });
      return { status: "moved", feedbackId: adjacentId };
    } catch (reason) {
      return {
        status: "failed",
        message: reason instanceof Error ? reason.message : stepCopy(liveMode, direction).failure,
      };
    }
  }, [batchId, liveMode, navigate, returnContext, sequence]);

  const goAdjacent = useCallback(async (direction: StepDirection) => {
    const fromId = liveCursorRef.current;
    if (!fromId || actionRef.current) return;
    actionRef.current = true;
    setNavigationDirection(direction);
    setReplyError(null);
    const outcome = await stepOnce(fromId, direction);
    if (outcome.status === "end") {
      if (direction === "next") setAtEnd(true);
      setLiveNotice(stepCopy(liveMode, direction).end);
    } else if (outcome.status === "failed") {
      setLiveNotice(null);
      setReplyError(outcome.message);
    }
    actionRef.current = false;
    setNavigationDirection(null);
  }, [liveMode, stepOnce]);

  /**
   * Arrow keys are queued instead of discarded: hammering the key used to advance a single
   * message because every press after the first landed while a request was still open.
   * The cursor is carried by the loop itself, so consecutive steps do not wait for React to
   * commit the previous navigation before resolving the next neighbour.
   */
  const requestStep = useCallback((direction: StepDirection) => {
    const queued = queueRef.current;
    if (stepRef.current || actionRef.current) {
      if (queued && queued.direction === direction) {
        queued.steps = Math.min(queued.steps + 1, MAX_QUEUED_STEPS);
      } else {
        queueRef.current = { direction, steps: 1 };
      }
      return;
    }
    const fromId = liveCursorRef.current;
    if (!fromId) return;
    stepRef.current = true;
    queueRef.current = { direction, steps: 1 };
    const run = async () => {
      let cursor: string | null = fromId;
      try {
        for (;;) {
          const pending = queueRef.current;
          if (!cursor || !pending || pending.steps <= 0) break;
          const stepDirection = pending.direction;
          // Claim this step before awaiting, so a press that lands mid-request queues a new one.
          pending.steps -= 1;
          if (pending.steps <= 0) queueRef.current = null;
          setNavigationDirection(stepDirection);
          setReplyError(null);
          const outcome = await stepOnce(cursor, stepDirection);
          if (outcome.status === "moved") {
            cursor = outcome.feedbackId;
            setLiveNotice(null);
          } else if (outcome.status === "end") {
            if (stepDirection === "next") setAtEnd(true);
            setLiveNotice(stepCopy(liveMode, stepDirection).end);
            break;
          } else {
            setLiveNotice(null);
            setReplyError(outcome.message);
            break;
          }
        }
      } finally {
        queueRef.current = null;
        stepRef.current = false;
        setNavigationDirection(null);
      }
    };
    void run();
  }, [liveMode, stepOnce]);

  useEffect(() => {
    if (!liveMode || lightboxIndex !== null) return undefined;
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      const target = event.target;
      if (target instanceof HTMLElement && (
        target.isContentEditable
        || target.matches("input, textarea, select")
        || target.closest("dialog[open]")
      )) return;
      event.preventDefault();
      requestStep(event.key === "ArrowLeft" ? "previous" : "next");
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [lightboxIndex, liveMode, requestStep]);

  const requestSubmit = () => {
    if (liveMode) return;
    if (!validateReply()) return;
    setConfirmOpen(true);
  };

  if (liveMode && !batchId) return <Navigate to="/studio/live-display?mode=live" replace />;
  if (error) {
    return (
      <div className="studio-page">
        <StudioError
          message={error}
          onRetry={() => {
            invalidateLiveFeedback(feedbackId, batchId);
            setError(null);
            setLoaded(null);
            setReload((value) => value + 1);
          }}
        />
      </div>
    );
  }
  if (!item) return <StudioLoading label="正在加载留言详情" />;
  if (liveMode && item.moderationStatus !== "kept") {
    return (
      <div className="studio-page">
        <StudioError
          message="这条留言尚不能进入直播，请等待筛选完成或返回列表。"
          onRetry={() => {
            invalidateLiveFeedback(feedbackId, batchId);
            setReload((value) => value + 1);
          }}
        />
        <Button type="button" variant="quiet" onClick={goBack}>返回列表</Button>
      </div>
    );
  }

  const topic = item.topic === "other" ? item.customTopic : TOPIC_LABELS[item.topic];
  const replies = [...item.replies].sort((left, right) => left.createdAt - right.createdAt);
  const fullPhone = !liveMode && revealedPhone && revealedPhone.userId === item.userId ? revealedPhone.phone : null;
  const currentDetailUrl = `${location.pathname}${location.search}`;
  const hasSequenceContext = studioFeedbackViewSchema.safeParse(new URLSearchParams(location.search).get("view")).success;

  if (liveMode) {
    return (
      <div className="studio-live-page" data-entry={instantEntry ? "instant" : undefined}>
        <section
          key={item.id}
          className="studio-live-stage"
          aria-label="直播留言展示"
          aria-describedby="studio-live-keyboard-help"
          aria-keyshortcuts="ArrowLeft ArrowRight"
        >
          <p id="studio-live-keyboard-help" className="sr-only">直播按提交时间从最早一条开始播放：右方向键查看更新的一条，左方向键回看更早的一条。</p>
          <div className="studio-live-frame">
            <header className="studio-live-identity" role="region" aria-label="昵称与主题" tabIndex={0}>
              <div className="studio-live-signal-mark" aria-hidden="true"><i /><i /><i /></div>
              <div className="studio-live-identity-copy">
                <h1>{item.nickname}</h1>
                <p>{topic || "其他"}</p>
              </div>
            </header>

            <article className={`studio-live-message${images.length > 0 ? " studio-live-message--with-images" : ""}`} aria-label="留言内容">
              <div className="studio-live-message-layout">
                <LiveMessageText content={item.content} />
                {images.length > 0 && (
                  <aside className={`studio-live-images studio-live-images--${images.length}`} aria-label="留言图片缩略图">
                    {images.map((image, index) => (
                      <button key={image.id} type="button" onClick={() => setLightboxIndex(index)} aria-label={`放大留言图片 ${index + 1}`}>
                        <img src={image.src} alt={image.alt} width={image.width} height={image.height} decoding="async" />
                      </button>
                    ))}
                  </aside>
                )}
              </div>
            </article>

            <div className="studio-live-navigation-status" aria-live="polite" aria-atomic="true">
              {replyError && <span className="studio-live-error" role="alert">{replyError}</span>}
              {liveNotice && <span role="status">{liveNotice}</span>}
            </div>
          </div>
        </section>

        {lightboxIndex !== null && <Lightbox images={images} initialIndex={lightboxIndex} onClose={() => setLightboxIndex(null)} />}
      </div>
    );
  }

  return (
    <div className="studio-page studio-detail-page">
      <header className="studio-detail-heading">
        <button type="button" className="studio-back-button" onClick={goBack}><ArrowLeft aria-hidden="true" />返回</button>
        <div>
          <span className={`studio-status studio-status--${item.status}`}>
            {item.status === "filtered" ? "已过滤" : item.status === "replied" ? "已回复" : "未回复"}
          </span>
          <code>#{item.feedbackNumber}</code>
        </div>
      </header>

      <article className="studio-feedback-detail">
        <div className="studio-detail-identity">
          <div><span>抖音昵称</span>{item.userId ? (
            <Link to={`/studio/user/${encodeURIComponent(item.userId)}`} state={{ backTo: currentDetailUrl, detailState: location.state }}><UserCircle aria-hidden="true" />{item.nickname}</Link>
          ) : (
            <strong><UserCircle aria-hidden="true" />{item.nickname}</strong>
          )}</div>
        </div>
        <div className="studio-detail-section">
          <span>主题</span>
          <h1>{topic}</h1>
        </div>
        <div className="studio-detail-section">
          <span>留言正文</span>
          <p className="studio-detail-content">{item.content}</p>
        </div>
        <div className="studio-detail-section studio-submitted-time">
          <span>提交时间</span>
          <strong><Clock aria-hidden="true" />{formatDate(item.createdAt)}</strong>
        </div>

        {images.length > 0 && (
          <section className="studio-detail-section" aria-labelledby="studio-images-title">
            <div className="studio-section-title"><span id="studio-images-title">图片</span><small><ImageSquare aria-hidden="true" />{images.length} 张</small></div>
            <div className="studio-image-grid">
              {images.map((image, index) => (
                <button key={image.id} type="button" onClick={() => setLightboxIndex(index)} aria-label={`放大留言图片 ${index + 1}`}>
                  <img src={image.src} alt={image.alt} width={image.width} height={image.height} loading="lazy" />
                  <span><Eye aria-hidden="true" />查看大图</span>
                </button>
              ))}
            </div>
          </section>
        )}

        <section className="studio-detail-section studio-phone-section studio-shop-phone-section" aria-labelledby="studio-shop-phone-title">
          <span id="studio-shop-phone-title">张导小店绑定手机号</span>
          <strong>{item.shopPhone || "未填写"}</strong>
        </section>

        {item.userId && item.maskedPhone && <section className="studio-detail-section studio-phone-section" aria-labelledby="studio-phone-title">
          <span id="studio-phone-title">手机号</span>
            <button
              type="button"
              className="studio-phone-value"
              disabled={revealing}
              title="双击显示完整手机号"
              onDoubleClick={() => void revealPhone()}
              onKeyDown={revealWithKeyboard}
            >
              {revealing ? "正在读取…" : fullPhone ?? item.maskedPhone}
              {!fullPhone && !revealing && <small>双击显示完整号码</small>}
            </button>
        </section>}

        {!liveMode && (
          <section className="studio-detail-section studio-moderation-section" aria-labelledby="studio-moderation-title">
            <div>
              <span id="studio-moderation-title">内容筛选</span>
              <strong>
                {item.moderationStatus === "filtered"
                  ? "已过滤"
                  : item.moderationStatus === "failed"
                    ? "AI 筛选失败，留言已保留"
                    : item.moderationStatus === "pending"
                      ? "等待 AI 筛选"
                      : "已保留"}
              </strong>
              {item.moderationReason && item.moderationStatus === "filtered" && (
                <small>{item.moderationReason}</small>
              )}
              {moderationNotice && <small role="status">{moderationNotice}</small>}
            </div>
            <div className="studio-moderation-actions">
              {item.replyCount === 0 && (item.moderationStatus === "failed" || item.moderationStatus === "pending") && (
                <Button type="button" variant="secondary" disabled={moderationBusy || submitting || deletingReply || navigationBusy || liveSelectionPending} onClick={() => void retryModeration()}>重新 AI 筛选</Button>
              )}
              <Button
                type="button"
                variant="secondary"
                loading={moderationBusy}
                loadingLabel="正在更新"
                disabled={submitting || deletingReply || navigationBusy || liveSelectionPending}
                icon={<ShieldWarning aria-hidden="true" />}
                onClick={() => void setFiltered(item.moderationStatus !== "filtered")}
              >
                {item.moderationStatus === "filtered" ? "恢复留言" : "标记为已过滤"}
              </Button>
              <LiveSelectionControl key={feedbackId} item={item}
                disabled={moderationBusy || submitting || deletingReply || navigationBusy || replyPending || confirmOpen}
                onPendingChange={setLiveSelectionPending}
                onUpdated={value => setLoaded(current => current?.feedbackId === value.id ? { feedbackId: value.id, item: value } : current)} />
            </div>
          </section>
        )}

        <ReplyHistory key={feedbackId} replies={replies}
          disabled={submitting || moderationBusy || navigationBusy || replyPending || liveSelectionPending}
          onDelete={deleteReply} />
      </article>

      <section className="studio-reply-composer" aria-labelledby="studio-compose-title">
        <div className="studio-section-title"><h2 id="studio-compose-title">追加回复</h2><small>{replyContent.length} / 2000</small></div>
        <fieldset className="studio-reply-types" disabled={submitting || deletingReply || navigationBusy || replyPending}>
          <legend>回复方式</legend>
          {(["live", "message"] as const).map((type) => (
            <label key={type}>
              <input type="radio" name="reply-type" value={type} checked={replyType === type} onChange={() => { setReplyType(type); setReplySubmitted(false); }} />
              <span>{type === "live" ? "直播回复" : "留言回复"}</span>
            </label>
          ))}
        </fieldset>
        <label className="sr-only" htmlFor="studio-reply-content">回复内容</label>
        <textarea
          ref={replyRef}
          id="studio-reply-content"
          value={replyContent}
          maxLength={2000}
          rows={7}
          disabled={submitting || deletingReply || navigationBusy || replyPending}
          placeholder="填写要追加的回复内容"
          aria-invalid={Boolean(replyError)}
          aria-describedby={replyError ? "studio-reply-error" : undefined}
          onChange={(event) => {
            setReplyContent(event.target.value);
            setReplyError(null);
            setReplySubmitted(false);
          }}
        />
        {replyError && <p id="studio-reply-error" className="studio-field-error" role="alert">{replyError}</p>}
        {replyPending && !submitting && !navigationBusy && <p role="status">尚未确认回复是否保存，请重试提交。确认前会保留原回复内容。</p>}
        {replySubmitted && (
          <p className="studio-reply-success" role="status">
            <CheckCircle aria-hidden="true" weight="fill" />
            {hasSequenceContext
              ? atEnd ? "回复已提交，这已经是当前列表最后一条留言。" : "回复已提交，可以继续处理下一条留言。"
              : "回复已提交。"}
          </p>
        )}
        <div className="studio-detail-actions">
          <Button type="button" variant="quiet" icon={<ArrowLeft aria-hidden="true" />} onClick={goBack}>返回</Button>
          {replySubmitted && hasSequenceContext ? (
            <Button
              type="button"
              loading={navigationDirection === "next"}
              loadingLabel="正在打开下一条"
              disabled={atEnd || navigationBusy}
              icon={<ArrowRight aria-hidden="true" weight="bold" />}
              onClick={() => void goAdjacent("next")}
            >
              {atEnd ? "已经是最后一条" : "下一条留言"}
            </Button>
          ) : (
            <Button type="button" loading={submitting} disabled={deletingReply || liveSelectionPending} loadingLabel="正在提交" icon={<PaperPlaneTilt aria-hidden="true" weight="fill" />} onClick={requestSubmit}>提交</Button>
          )}
        </div>
      </section>

      <ConfirmDialog
        open={confirmOpen}
        title="确认提交这条回复？"
        description="提交后无法修改。"
        confirmLabel="确认提交"
        busy={submitting}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={() => void submitReply()}
      />
      {lightboxIndex !== null && <Lightbox images={images} initialIndex={lightboxIndex} onClose={() => setLightboxIndex(null)} />}
    </div>
  );
}
