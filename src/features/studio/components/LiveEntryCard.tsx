import { useEffect, useId, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Button } from "../../../components/Button";
import { TOPIC_LABELS } from "../../../shared/contracts";
import type { LiveEntry } from "../../../shared/live-contracts";
import { replyCountLabel } from "../reply-count";
const dateFormat = new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });

export function LiveEntryCard({ item, batchId, archived, disabled, expanded, onExpand, onOpen, onRemove, children }: {
  item: LiveEntry; batchId: string; archived: boolean; disabled: boolean; expanded: boolean;
  onExpand: () => void; onOpen: (event: MouseEvent<HTMLAnchorElement>, target: string, element: HTMLElement | null) => void;
  onRemove: () => void; children: ReactNode;
}) {
  const ref = useRef<HTMLElement>(null);
  const contentRef = useRef<HTMLParagraphElement>(null);
  const contentId = useId();
  const [overflows, setOverflows] = useState(false);
  useEffect(() => {
    const element = contentRef.current;
    if (!element || expanded) return;
    const measure = () => setOverflows(element.scrollHeight > element.clientHeight + 1);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure); observer.observe(element);
    return () => observer.disconnect();
  }, [expanded, item.content]);
  const target = item.feedbackId ? `/studio/feedback/${item.feedbackId}?view=live_display`
    : `/studio/live-display/${item.id}?batch=${batchId}`;
  return <article ref={ref} className="studio-feedback-card studio-live-row" data-feedback-id={item.id}>
    {children}
    <div className="studio-feedback-card-main">
      <div className="studio-live-card-topline">
        <p>{item.sourceType === "imported" ? "Excel 导入" : "观众提交"} · {item.topic === "other" ? item.customTopic : TOPIC_LABELS[item.topic]}</p>
        <span className={`studio-status ${item.replyCount > 0 ? "studio-status--replied" : "studio-live-status-unreplied"}`}>{replyCountLabel(item.replyCount ?? 0)}</span>
      </div>
      <h2><Link className="studio-live-card-link" to={target} aria-label={`查看${item.nickname}的留言详情`} aria-disabled={disabled || undefined}
        onClick={event => { if (disabled) event.preventDefault(); else onOpen(event, target, ref.current); }}>{item.nickname}</Link></h2>
      <p id={contentId} ref={contentRef} className={`studio-live-entry-content${expanded ? "" : " is-collapsed"}`}>{item.content}</p>
      {(overflows || expanded) && <Button className="studio-live-card-action studio-live-expand" variant="quiet" type="button" aria-controls={contentId} aria-expanded={expanded} onClick={onExpand}>{expanded ? "收起正文" : "展开全文"}</Button>}
      <p>{item.sourceType === "imported" ? `导入于 ${dateFormat.format(item.addedAt)} · ${item.filename} · 第 ${item.importRowNumber} 行` : `提交于 ${dateFormat.format(item.createdAt)}`}</p>
      {item.imageCount > 0 && <p>{item.imageCount} 张图片（原留言中查看）</p>}
      {!archived && <Button className="studio-live-card-action studio-live-remove" type="button" variant="quiet" disabled={disabled} onClick={onRemove}>取消直播展示</Button>}
    </div>
  </article>;
}
