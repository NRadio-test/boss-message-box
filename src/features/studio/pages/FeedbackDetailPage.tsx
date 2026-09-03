import {
  ArrowLeft,
  Broadcast,
  ChatCircleText,
  Clock,
  Eye,
  ImageSquare,
  PaperPlaneTilt,
  UserCircle,
} from "@phosphor-icons/react";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Link, useLocation, useNavigate, useOutletContext, useParams } from "react-router-dom";
import { Button } from "../../../components/Button";
import { TOPIC_LABELS } from "../../../shared/contracts";
import type { StudioFeedbackDetail, StudioReplyType } from "../../../shared/studio-contracts";
import { createStudioReply, getStudioFeedback, revealStudioPhone } from "../api";
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

export function FeedbackDetailPage() {
  const { feedbackId = "" } = useParams();
  const { liveMode } = useOutletContext<StudioOutletContext>();
  const location = useLocation();
  const navigate = useNavigate();
  const returnContext = (location.state as DetailLocationState | null)?.returnContext ?? null;
  const [item, setItem] = useState<StudioFeedbackDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [fullPhone, setFullPhone] = useState<string | null>(null);
  const [revealing, setRevealing] = useState(false);
  const [replyType, setReplyType] = useState<StudioReplyType | null>(null);
  const [replyContent, setReplyContent] = useState("");
  const [replyError, setReplyError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const replyRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    setError(null);
    setItem(null);
    getStudioFeedback(feedbackId, controller.signal)
      .then((value) => setItem(value.item))
      .catch((reason) => {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "留言详情加载失败");
      });
    return () => controller.abort();
  }, [feedbackId, reload]);

  useEffect(() => setFullPhone(null), [feedbackId, liveMode]);

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
    if (!item || liveMode || revealing || fullPhone) return;
    setRevealing(true);
    setReplyError(null);
    try {
      setFullPhone((await revealStudioPhone(item.userId)).phone);
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
    if (!item || !validateReply()) return;
    setSubmitting(true);
    try {
      const value = await createStudioReply(
        item.id,
        replyContent.trim(),
        liveMode ? undefined : replyType ?? undefined,
      );
      setItem((current) => current ? {
        ...current,
        replies: [...current.replies, value.reply],
        status: value.status,
        isTodo: value.isTodo,
        replyCount: value.replyCount,
        latestReplyAdmin: value.latestReplyAdmin,
      } : current);
      setReplyContent("");
      setReplyType(null);
      setConfirmOpen(false);
    } catch (reason) {
      setReplyError(reason instanceof Error ? reason.message : "回复提交失败，请稍后重试");
    } finally {
      setSubmitting(false);
    }
  };

  const requestSubmit = () => {
    if (!validateReply()) return;
    if (liveMode) void submitReply();
    else setConfirmOpen(true);
  };

  if (error) return <div className="studio-page"><StudioError message={error} onRetry={() => setReload((value) => value + 1)} /></div>;
  if (!item) return <StudioLoading label="正在加载留言详情" />;

  const topic = item.topic === "other" ? item.customTopic : TOPIC_LABELS[item.topic];
  const replies = [...item.replies].sort((left, right) => left.createdAt - right.createdAt);
  const currentDetailUrl = `${location.pathname}${location.search}`;

  return (
    <div className="studio-page studio-detail-page">
      <header className="studio-detail-heading">
        <button type="button" className="studio-back-button" onClick={goBack}><ArrowLeft aria-hidden="true" />返回</button>
        <div>
          <span className={`studio-status studio-status--${item.status}`}>{item.status === "replied" ? "已回复" : "未回复"}</span>
          <code>#{item.feedbackNumber}</code>
        </div>
      </header>

      <article className="studio-feedback-detail">
        <div className="studio-detail-identity">
          <div><span>抖音昵称</span><Link to={`/studio/user/${encodeURIComponent(item.userId)}${liveMode ? "?mode=live" : ""}`} state={{ backTo: currentDetailUrl, detailState: location.state }}><UserCircle aria-hidden="true" />{item.nickname}</Link></div>
          <div><span>提交时间</span><strong><Clock aria-hidden="true" />{formatDate(item.createdAt)}</strong></div>
        </div>
        <div className="studio-detail-section">
          <span>主题</span>
          <h1>{topic}</h1>
        </div>
        <div className="studio-detail-section">
          <span>留言正文</span>
          <p className="studio-detail-content">{item.content}</p>
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

        <section className="studio-detail-section studio-phone-section" aria-labelledby="studio-phone-title">
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
        </section>

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
        <div className="studio-section-title"><h2 id="studio-compose-title">追加回复</h2><small>{replyContent.length} / 2000</small></div>
        <fieldset className="studio-reply-types">
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
          placeholder="填写要追加的回复内容"
          aria-invalid={Boolean(replyError)}
          aria-describedby={replyError ? "studio-reply-error" : undefined}
          onChange={(event) => {
            setReplyContent(event.target.value);
            setReplyError(null);
          }}
        />
        {replyError && <p id="studio-reply-error" className="studio-field-error" role="alert">{replyError}</p>}
        <div className="studio-detail-actions">
          <Button type="button" variant="quiet" icon={<ArrowLeft aria-hidden="true" />} onClick={goBack}>返回</Button>
          <Button type="button" loading={submitting} loadingLabel="正在提交" icon={<PaperPlaneTilt aria-hidden="true" weight="fill" />} onClick={requestSubmit}>提交</Button>
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
