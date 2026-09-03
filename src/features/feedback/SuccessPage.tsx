import { ArrowRight, CheckCircle } from "@phosphor-icons/react";
import { Link, useLocation } from "react-router-dom";
import type { SubmitSuccess } from "../../shared/contracts";

export function SuccessPage() {
  const result = useLocation().state as SubmitSuccess | null;
  return (
    <section className="success-page" aria-labelledby="success-title">
      <div className="success-mark"><CheckCircle aria-hidden="true" weight="fill" /></div>
      <span className="dialog-kicker">提交回执</span>
      <h1 id="success-title">留言已提交</h1>
      <p>我们已经收到你的留言，它会进入后续的直播处理流程。</p>
      {result?.feedbackId && <div className="receipt-id"><span>留言编号</span><code>{result.feedbackId.slice(0, 8).toUpperCase()}</code></div>}
      <div className="success-actions">
        <Link className="button button--primary" to="/my">查看我的留言 <ArrowRight aria-hidden="true" /></Link>
        <Link className="button button--secondary" to="/">继续留言</Link>
      </div>
    </section>
  );
}
