import { ChatCircleText, Clock, ImageSquare, MagnifyingGlass } from "@phosphor-icons/react";
import { useState } from "react";
import { Button } from "../../components/Button";
import { FormField } from "../../components/FormField";
import { ApiClientError, queryHistory } from "../../lib/api";
import { historyQuerySchema, TOPIC_LABELS, type PublicFeedback } from "../../shared/contracts";
import { loadIdentity } from "../feedback/draft-store";

function formatDate(timestamp: number): string {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(timestamp));
}

export function HistoryPage() {
  const identity = loadIdentity();
  const [phone, setPhone] = useState(identity?.phone ?? "");
  const [nickname, setNickname] = useState(identity?.nickname ?? "");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<PublicFeedback[] | null>(null);

  const submit = async () => {
    const parsed = historyQuerySchema.safeParse({ phone, nickname });
    if (!parsed.success) {
      const nextErrors: Record<string, string> = {};
      for (const issue of parsed.error.issues) nextErrors[String(issue.path[0])] = issue.message;
      setErrors(nextErrors);
      requestAnimationFrame(() =>
        document.querySelector<HTMLElement>('.history-query [aria-invalid="true"]')?.focus(),
      );
      return;
    }
    setErrors({});
    setMessage(null);
    setLoading(true);
    try {
      const result = await queryHistory(parsed.data);
      setItems(result.items);
    } catch (error) {
      setItems(null);
      setMessage(
        error instanceof ApiClientError || error instanceof Error
          ? error.message
          : "查询失败，请稍后重试",
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="page-column history-page">
      <section className="page-intro">
        <div className="signal-caption"><span /> 留言回执</div>
        <h1>查看我的留言</h1>
        <p>使用提交时填写的中国大陆手机号和抖音昵称查询，无需短信验证码。</p>
      </section>
      <form className="history-query" noValidate onSubmit={(event) => { event.preventDefault(); void submit(); }}>
        <FormField label="抖音昵称" htmlFor="history-nickname" required error={errors.nickname}>
          <input
            id="history-nickname"
            required
            value={nickname}
            maxLength={40}
            autoComplete="nickname"
            enterKeyHint="next"
            onChange={(event) => setNickname(event.target.value)}
            aria-invalid={Boolean(errors.nickname)}
            aria-describedby={errors.nickname ? "history-nickname-error" : undefined}
          />
        </FormField>
        <FormField label="手机号" htmlFor="history-phone" required error={errors.phone}>
          <div className="phone-input">
            <span className="phone-prefix" aria-hidden="true">+86</span>
            <input
              id="history-phone"
              required
              type="tel"
              inputMode="tel"
              autoComplete="tel-national"
              enterKeyHint="search"
              value={phone}
              maxLength={13}
              onChange={(event) => setPhone(event.target.value.replace(/[^\d\s-]/g, ""))}
              aria-invalid={Boolean(errors.phone)}
              aria-describedby={errors.phone ? "history-phone-error" : undefined}
            />
          </div>
        </FormField>
        {message && <p className="form-message" role="alert">{message}</p>}
        <Button type="submit" loading={loading} loadingLabel="正在查询" icon={<MagnifyingGlass aria-hidden="true" weight="bold" />}>
          查询留言
        </Button>
      </form>

      {items && (
        <section className="history-results" aria-live="polite">
          <div className="results-heading"><h2>共 {items.length} 条留言</h2><span>按提交时间从新到旧</span></div>
          <ol>
            {items.map((item) => (
              <li key={item.id} className="message-card">
                <div className="message-meta">
                  <span className={`status status--${item.status}`}>{item.status === "replied" ? "已回复" : "未回复"}</span>
                  <span><Clock aria-hidden="true" /> {formatDate(item.createdAt)}</span>
                </div>
                <h3>{item.topic === "other" ? item.customTopic : TOPIC_LABELS[item.topic]}</h3>
                <p className="message-content">{item.content}</p>
                {item.imageCount > 0 && <div className="image-count"><ImageSquare aria-hidden="true" /> 已提交 {item.imageCount} 张图片</div>}
                {item.status === "replied" && item.replies.length > 0 && (
                  <div className="reply-list" aria-label="官方回复">
                    {item.replies.map((reply) => (
                      <div className="reply-block" key={reply.id}>
                        <div>
                          <span><ChatCircleText aria-hidden="true" weight="fill" /> 官方回复</span>
                          <span>{reply.replyType === "live" ? "直播回复" : "留言回复"} · {formatDate(reply.createdAt)}</span>
                        </div>
                        <p>{reply.content}</p>
                      </div>
                    ))}
                  </div>
                )}
              </li>
            ))}
          </ol>
        </section>
      )}
    </div>
  );
}
