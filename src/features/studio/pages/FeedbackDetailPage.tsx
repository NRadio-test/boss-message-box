import {
  ArrowLeft,
  ArrowRight,
  Broadcast,
  ChatCircleText,
  Clock,
  Eye,
  ImageSquare,
  PaperPlaneTilt,
  ShieldWarning,
  UserCircle,
} from "@phosphor-icons/react";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Link, useLocation, useNavigate, useOutletContext, useParams } from "react-router-dom";
import { Button } from "../../../components/Button";
import { createRandomUuid } from "../../../lib/random-id";
import { TOPIC_LABELS, TOPIC_VALUES, type Topic } from "../../../shared/contracts";
import type { StudioFeedbackDetail, StudioReplyType } from "../../../shared/studio-contracts";
import {
  createStudioReply,
  getNextStudioFeedback,
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
}

interface ReplyAttempt {
  feedbackId: string;
  content: string;
  replyType?: StudioReplyType;
  requestKey: string;
}

export function FeedbackDetailPage() {
  const { feedbackId = "" } = useParams();
  const { liveMode } = useOutletContext<StudioOutletContext>();
  const location = useLocation();
  const navigate = useNavigate();
  const returnContext = (location.state as DetailLocationState | null)?.returnContext ?? null;
  const [loaded, setLoaded] = useState<{ feedbackId: string; item: StudioFeedbackDetail } | null>(null);
  const item = loaded?.feedbackId === feedbackId ? loaded.item : null;
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [revealedPhone, setRevealedPhone] = useState<{ userId: string; phone: string } | null>(null);
  const [revealing, setRevealing] = useState(false);
  const [replyType, setReplyType] = useState<StudioReplyType | null>(null);
  const [replyContent, setReplyContent] = useState("");
  const [replyError, setReplyError] = useState<string | null>(null);
  const [replyPending, setReplyPending] = useState(false);
  const [moderationNotice, setModerationNotice] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [moderationBusy, setModerationBusy] = useState(false);
  const [nextBusy, setNextBusy] = useState(false);
  const [atEnd, setAtEnd] = useState(false);
  const [liveNotice, setLiveNotice] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const replyRef = useRef<HTMLTextAreaElement>(null);
  const actionRef = useRef(false);
  const replyAttemptRef = useRef<ReplyAttempt | null>(null);
  const currentFeedbackRef = useRef(feedbackId);

  useEffect(() => {
    const controller = new AbortController();
    if (currentFeedbackRef.current !== feedbackId) {
      currentFeedbackRef.current = feedbackId;
      replyAttemptRef.current = null;
      setReplyPending(false);
      setAtEnd(false);
      setLiveNotice(null);
      setModerationNotice(null);
      setReplyContent("");
      setReplyType(null);
      setReplyError(null);
    }
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
  }, [feedbackId, liveMode, reload]);

  const images = useMemo<LightboxImage[]>(
    () => item?.images.map((image, index) => ({
      id: image.id,
      src: image.viewUrl,
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
    if (!liveMode && !replyType) {
      setReplyError("请选择直播回复或留言回复");
      return false;
    }
    setReplyError(null);
    return true;
  };

  const submitReply = async () => {
    if (!item || actionRef.current || !validateReply()) return;
    actionRef.current = true;
    setSubmitting(true);
    try {
      await saveReply(replyContent.trim(), liveMode ? undefined : replyType ?? undefined);
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

  const retryModeration = async () => {
    if (!item || liveMode || moderationBusy || actionRef.current) return;
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
    if (!item || liveMode || moderationBusy || actionRef.current) return;
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

  const goNext = async () => {
    if (!item || actionRef.current) return;
    const content = replyContent.trim();
    if (atEnd && !content) return;
    if (content.length > 2000) {
      setReplyError("回复内容不能超过 2000 个字符");
      replyRef.current?.focus();
      return;
    }
    actionRef.current = true;
    setNextBusy(true);
    setReplyError(null);
    setLiveNotice(null);
    try {
      if (content) {
        await saveReply(content);
      }
      if (atEnd) {
        setLiveNotice("回复已保存，已经是最后一条了");
        return;
      }
      const query = new URLSearchParams(location.search);
      const view = query.get("view") === "todo" ? "todo" : "unreplied";
      const topicValue = query.get("topic");
      const topic = topicValue && TOPIC_VALUES.includes(topicValue as Topic)
        ? topicValue as Topic
        : null;
      const next = await getNextStudioFeedback(item.id, view, topic);
      if (currentFeedbackRef.current !== item.id) return;
      if (!next.nextFeedbackId) {
        setAtEnd(true);
        setLiveNotice("已经是最后一条了");
        return;
      }
      const nextQuery = new URLSearchParams({ mode: "live", view });
      if (topic) nextQuery.set("topic", topic);
      navigate(`/studio/feedback/${encodeURIComponent(next.nextFeedbackId)}?${nextQuery}`, {
        replace: true,
        state: { returnContext },
      });
      window.scrollTo({ top: 0, behavior: "instant" });
    } catch (reason) {
      setReplyError(reason instanceof Error ? reason.message : "下一条留言暂时无法加载");
    } finally {
      actionRef.current = false;
      setNextBusy(false);
    }
  };

  const requestSubmit = () => {
    if (!validateReply()) return;
    if (liveMode) void submitReply();
    else setConfirmOpen(true);
  };

  if (error) return <div className="studio-page"><StudioError message={error} onRetry={() => { setError(null); setLoaded(null); setReload((value) => value + 1); }} /></div>;
  if (!item) return <StudioLoading label="正在加载留言详情" />;
  if (liveMode && item.moderationStatus !== "kept" && item.moderationStatus !== "failed") {
    return <div className="studio-page"><StudioError message="这条留言尚不能进入直播，请等待筛选完成或返回列表。" onRetry={() => setReload((value) => value + 1)} /><Button type="button" variant="quiet" onClick={goBack}>返回列表</Button></div>;
  }

  const topic = item.topic === "other" ? item.customTopic : TOPIC_LABELS[item.topic];
  const replies = [...item.replies].sort((left, right) => left.createdAt - right.createdAt);
  const fullPhone = !liveMode && revealedPhone && revealedPhone.userId === item.userId ? revealedPhone.phone : null;
  const currentDetailUrl = `${location.pathname}${location.search}`;

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
            <Link to={`/studio/user/${encodeURIComponent(item.userId)}${liveMode ? "?mode=live" : ""}`} state={{ backTo: currentDetailUrl, detailState: location.state }}><UserCircle aria-hidden="true" />{item.nickname}</Link>
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

        {item.userId && item.maskedPhone && <section className="studio-detail-section studio-phone-section" aria-labelledby="studio-phone-title">
          <span id="studio-phone-title">手机号</span>
          {liveMode ? (
            <div className="studio-phone-value is-locked"><Broadcast aria-hidden="true" />直播模式下仅显示 {item.maskedPhone}</div>
          ) : (
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
          )}
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
            {item.replyCount === 0 && (item.moderationStatus === "failed" || item.moderationStatus === "pending") && (
              <Button type="button" variant="secondary" disabled={moderationBusy || submitting || nextBusy} onClick={() => void retryModeration()}>重新 AI 筛选</Button>
            )}
            <Button
              type="button"
              variant="secondary"
              loading={moderationBusy}
              loadingLabel="正在更新"
              disabled={submitting || nextBusy}
              icon={<ShieldWarning aria-hidden="true" />}
              onClick={() => void setFiltered(item.moderationStatus !== "filtered")}
            >
              {item.moderationStatus === "filtered" ? "恢复留言" : "标记为已过滤"}
            </Button>
          </section>
        )}

        <section className="studio-detail-section" aria-labelledby="studio-replies-title">
          <div className="studio-section-title"><span id="studio-replies-title">历史回复</span><small>{replies.length} 条</small></div>
          {replies.length === 0 ? <p className="studio-inline-empty">还没有回复。</p> : (
            <ol className="studio-reply-history">
              {replies.map((reply) => (
                <li key={reply.id}>
                  <div>
                    <span><ChatCircleText aria-hidden="true" />{reply.replyType === "live" ? "直播回复" : "留言回复"}</span>
                    <time dateTime={new Date(reply.createdAt).toISOString()}>{formatDate(reply.createdAt)}</time>
                  </div>
                  <p>{reply.content}</p>
                  <small>回复人：{reply.adminUsername ?? "历史回复"}</small>
                </li>
              ))}
            </ol>
          )}
        </section>
      </article>

      <section className="studio-reply-composer" aria-labelledby="studio-compose-title">
        <div className="studio-section-title"><h2 id="studio-compose-title">{liveMode ? "直播回复（可留空）" : "追加回复"}</h2><small>{replyContent.length} / 2000</small></div>
        <fieldset className="studio-reply-types" disabled={submitting || nextBusy || replyPending}>
          <legend>回复方式</legend>
          {liveMode ? (
            <div className="studio-locked-reply-type"><Broadcast aria-hidden="true" />直播回复</div>
          ) : (["live", "message"] as const).map((type) => (
            <label key={type}>
              <input type="radio" name="reply-type" value={type} checked={replyType === type} onChange={() => setReplyType(type)} />
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
          disabled={submitting || nextBusy || replyPending}
          placeholder="填写要追加的回复内容"
          aria-invalid={Boolean(replyError)}
          aria-describedby={replyError ? "studio-reply-error" : undefined}
          onChange={(event) => {
            setReplyContent(event.target.value);
            setReplyError(null);
          }}
        />
        {replyError && <p id="studio-reply-error" className="studio-field-error" role="alert">{replyError}</p>}
        {replyPending && !submitting && !nextBusy && <p role="status">尚未确认回复是否保存，请重试提交。确认前会保留原回复内容。</p>}
        {!liveMode && <div className="studio-detail-actions">
          <Button type="button" variant="quiet" icon={<ArrowLeft aria-hidden="true" />} onClick={goBack}>返回</Button>
          <Button type="button" loading={submitting} loadingLabel="正在提交" icon={<PaperPlaneTilt aria-hidden="true" weight="fill" />} onClick={requestSubmit}>提交</Button>
        </div>}
      </section>

      {liveMode && (
        <div className="studio-live-next-wrap">
          {liveNotice && <span role="status">{liveNotice}</span>}
          <Button
            type="button"
            className="studio-live-next"
            loading={nextBusy}
            loadingLabel={replyContent.trim() ? "正在保存并前进" : "正在打开下一条"}
            disabled={atEnd && !replyContent.trim()}
            icon={<ArrowRight aria-hidden="true" weight="bold" />}
            onClick={() => void goNext()}
          >
            {atEnd ? replyContent.trim() ? "保存回复" : "已经是最后一条" : "下一条"}
          </Button>
        </div>
      )}

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
