import { ArrowLeft, Broadcast, Clock, Eye, UserCircle } from "@phosphor-icons/react";
import { useEffect, useState, type KeyboardEvent } from "react";
import { useLocation, useNavigate, useOutletContext, useParams } from "react-router-dom";
import type { StudioUserDetailSuccess } from "../../../shared/studio-contracts";
import { getStudioUser, revealStudioPhone } from "../api";
import { StudioError, StudioLoading } from "../components/AsyncState";
import { FeedbackCard } from "../components/FeedbackCard";
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

interface UserLocationState {
  backTo?: string;
  detailState?: unknown;
}

export function UserDetailPage() {
  const { userId = "" } = useParams();
  const { liveMode } = useOutletContext<StudioOutletContext>();
  const location = useLocation();
  const navigate = useNavigate();
  const state = location.state as UserLocationState | null;
  const [result, setResult] = useState<StudioUserDetailSuccess | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [fullPhone, setFullPhone] = useState<string | null>(null);
  const [revealing, setRevealing] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    setError(null);
    getStudioUser(userId, controller.signal)
      .then(setResult)
      .catch((reason) => {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "用户信息加载失败");
      });
    return () => controller.abort();
  }, [reload, userId]);

  useEffect(() => setFullPhone(null), [liveMode, userId]);

  const reveal = async () => {
    if (liveMode || fullPhone || revealing) return;
    setRevealing(true);
    setError(null);
    try {
      setFullPhone((await revealStudioPhone(userId)).phone);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "手机号暂时无法显示");
    } finally {
      setRevealing(false);
    }
  };

  const revealWithKeyboard = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    void reveal();
  };

  const goBack = () => {
    if (state?.backTo) navigate(state.backTo, { state: state.detailState });
    else navigate(`/studio/unreplied${liveMode ? "?mode=live" : ""}`);
  };

  if (error && !result) return <div className="studio-page"><StudioError message={error} onRetry={() => setReload((value) => value + 1)} /></div>;
  if (!result) return <StudioLoading label="正在加载用户信息" />;

  const currentUrl = `${location.pathname}${location.search}`;
  return (
    <div className="studio-page studio-user-page">
      <header className="studio-detail-heading">
        <button type="button" className="studio-back-button" onClick={goBack}><ArrowLeft aria-hidden="true" />返回</button>
        <span className="studio-kicker">用户记录</span>
      </header>
      <section className="studio-user-summary" aria-labelledby="studio-user-title">
        <div className="studio-user-mark"><UserCircle aria-hidden="true" weight="duotone" /></div>
        <div className="studio-user-title"><span>抖音昵称</span><h1 id="studio-user-title">{result.user.nickname}</h1></div>
        <dl>
          <div><dt>首次留言</dt><dd><Clock aria-hidden="true" />{formatDate(result.user.firstFeedbackAt)}</dd></div>
          <div><dt>留言总数</dt><dd>{result.user.feedbackCount} 条</dd></div>
          <div className="studio-user-phone"><dt>手机号</dt><dd>
            {liveMode ? (
              <span><Broadcast aria-hidden="true" />{result.user.maskedPhone}</span>
            ) : (
              <button type="button" disabled={revealing} title="双击显示完整手机号" onDoubleClick={() => void reveal()} onKeyDown={revealWithKeyboard}>
                {revealing ? "正在读取…" : fullPhone ?? result.user.maskedPhone}
                {!fullPhone && !revealing && <Eye aria-hidden="true" />}
              </button>
            )}
          </dd></div>
        </dl>
        {error && <p className="studio-field-error" role="alert">{error}</p>}
      </section>

      <section className="studio-user-history" aria-labelledby="studio-user-history-title">
        <header className="studio-page-heading"><div><span className="studio-kicker">历史留言</span><h2 id="studio-user-history-title">全部留言</h2></div></header>
        {result.feedbacks.length === 0 ? <p className="studio-inline-empty">还没有留言记录。</p> : (
          <div className="studio-feedback-grid">
            {result.feedbacks.map((item) => (
              <FeedbackCard
                key={item.id}
                item={item}
                liveMode={liveMode}
                showTodoAction={false}
                onTodoChange={() => undefined}
                returnContext={{ url: currentUrl, anchorId: item.id }}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
