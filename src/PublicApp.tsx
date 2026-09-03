import { ArrowClockwise } from "@phosphor-icons/react";
import { lazy, Suspense, useEffect, useState } from "react";
import { Route, Routes } from "react-router-dom";
import { AppShell } from "./components/AppShell";
import { Button } from "./components/Button";
import { FeedbackForm } from "./features/feedback/FeedbackForm";
import { getPublicConfig } from "./lib/api";
import type { PublicConfig } from "./shared/contracts";

const SuccessPage = lazy(() =>
  import("./features/feedback/SuccessPage").then((module) => ({ default: module.SuccessPage })),
);
const HistoryPage = lazy(() =>
  import("./features/history/HistoryPage").then((module) => ({ default: module.HistoryPage })),
);

export function PublicApp() {
  const [config, setConfig] = useState<PublicConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    getPublicConfig(controller.signal)
      .then((value) => {
        setConfig(value);
        setError(null);
      })
      .catch((reason) => setError(reason instanceof Error ? reason.message : "服务配置加载失败"));
    return () => controller.abort();
  }, [reload]);

  if (error) {
    return (
      <div className="boot-state" role="alert">
        <h1>暂时无法打开留言箱</h1>
        <p>{error}</p>
        <Button
          icon={<ArrowClockwise aria-hidden="true" />}
          onClick={() => setReload((value) => value + 1)}
        >
          重新连接
        </Button>
      </div>
    );
  }
  if (!config) {
    return (
      <div className="boot-state" aria-live="polite">
        <span className="boot-signal" />
        <p>正在打开留言箱…</p>
      </div>
    );
  }

  return (
    <AppShell>
      <Suspense fallback={<div className="route-loading" aria-live="polite">正在打开…</div>}>
        <Routes>
          <Route path="/" element={<FeedbackForm config={config} />} />
          <Route path="/my" element={<HistoryPage />} />
          <Route path="/success" element={<SuccessPage />} />
          <Route path="*" element={<FeedbackForm config={config} />} />
        </Routes>
      </Suspense>
    </AppShell>
  );
}
