import { BookmarkSimple, ChatCircleText, Clock, ImageSquare, UserCircle } from "@phosphor-icons/react";
import { Link } from "react-router-dom";
import { TOPIC_LABELS } from "../../../shared/contracts";
import type { StudioFeedbackSummary } from "../../../shared/studio-contracts";
import type { Topic } from "../../../shared/contracts";
import type { StudioReturnContext } from "../navigation-context";

function formatDate(timestamp: number): string {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(timestamp));
}

interface FeedbackCardProps {
  item: StudioFeedbackSummary;
  returnContext: StudioReturnContext;
  liveMode: boolean;
  showTodoAction?: boolean;
  todoBusy?: boolean;
  onTodoChange: (item: StudioFeedbackSummary) => void;
  liveContext?: { view: "unreplied" | "todo"; topic: Topic | null };
}

export function FeedbackCard({
  item,
  returnContext,
  liveMode,
  showTodoAction = true,
  todoBusy = false,
  onTodoChange,
  liveContext,
}: FeedbackCardProps) {
  const detailQuery = new URLSearchParams();
  if (liveMode) detailQuery.set("mode", "live");
  if (liveMode && liveContext) {
    detailQuery.set("view", liveContext.view);
    if (liveContext.topic) detailQuery.set("topic", liveContext.topic);
  }
  const detailUrl = `/studio/feedback/${encodeURIComponent(item.id)}${detailQuery.size ? `?${detailQuery}` : ""}`;
  const title = item.topic === "other" ? item.customTopic : TOPIC_LABELS[item.topic];

  return (
    <article className="studio-feedback-card" data-feedback-id={item.id}>
      <Link className="studio-feedback-card-main" to={detailUrl} state={{ returnContext }}>
        <div className="studio-card-topline">
          <span className={`studio-status studio-status--${item.status}`}>
            {item.status === "filtered" ? "已过滤" : item.status === "replied" ? "已回复" : "未回复"}
          </span>
          {item.moderationStatus === "failed" && (
            <span className="studio-moderation-failed">AI 筛选失败</span>
          )}
          {item.moderationStatus === "pending" && (
            <span>等待 AI 筛选</span>
          )}
          <code>#{item.feedbackNumber}</code>
        </div>
        <dl className="studio-card-fields">
          <div><dt>抖音昵称</dt><dd>{item.nickname}</dd></div>
          <div><dt>主题</dt><dd>{title}</dd></div>
        </dl>
        <p className="studio-card-preview">{item.contentPreview}</p>
        <div className="studio-card-meta">
          <span><ImageSquare aria-hidden="true" />{item.imageCount} 张图片</span>
          <span><Clock aria-hidden="true" />{formatDate(item.createdAt)}</span>
        </div>
        {item.replyCount > 0 && (
          <div className="studio-card-reply-meta">
            <span><ChatCircleText aria-hidden="true" />{item.replyCount} 条回复</span>
            <span><UserCircle aria-hidden="true" />最近回复：{item.latestReplyAdmin ?? "历史回复"}</span>
          </div>
        )}
      </Link>
      {!liveMode && showTodoAction && item.status === "unreplied" && (
        <button
          type="button"
          className={`studio-todo-button ${item.isTodo ? "is-active" : ""}`}
          disabled={todoBusy}
          aria-pressed={item.isTodo}
          onClick={() => onTodoChange(item)}
        >
          <BookmarkSimple aria-hidden="true" weight={item.isTodo ? "fill" : "regular"} />
          {todoBusy ? "正在更新" : item.isTodo ? "取消待办" : "加入待办"}
        </button>
      )}
    </article>
  );
}
