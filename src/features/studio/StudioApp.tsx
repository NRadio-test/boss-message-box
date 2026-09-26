import { Navigate, Outlet, Route, Routes, useLocation } from "react-router-dom";
import { StudioLoading } from "./components/AsyncState";
import { StudioShell } from "./components/StudioShell";
import { FeedbackDetailPage } from "./pages/FeedbackDetailPage";
import { FeedbackListPage } from "./pages/FeedbackListPage";
import { LoginPage } from "./pages/LoginPage";
import { PasswordPage } from "./pages/PasswordPage";
import { SearchPage } from "./pages/SearchPage";
import { UserDetailPage } from "./pages/UserDetailPage";
import { LiveDisplayPage } from "./pages/LiveDisplayPage";
import { ImportedDetailPage } from "./pages/ImportedDetailPage";
import { UltraPhotosPage } from "./pages/UltraPhotosPage";
import { StudioSessionProvider } from "./session";
import { useStudioSession } from "./use-studio-session";
import "./studio.css";

function SessionGate() {
  const session = useStudioSession();
  const location = useLocation();
  if (session.status === "loading") return <StudioLoading label="正在验证 Studio 会话" />;
  if (session.status === "anonymous") {
    return (
      <Navigate
        to="/studio/login"
        replace
        state={{ from: `${location.pathname}${location.search}` }}
      />
    );
  }
  return <Outlet />;
}

export function StudioApp() {
  return (
    <StudioSessionProvider>
      <Routes>
        <Route path="login" element={<LoginPage />} />
        <Route element={<SessionGate />}>
          <Route index element={<Navigate to="/studio/unreplied" replace />} />
          <Route element={<StudioShell />}>
            <Route path="routing" element={<FeedbackListPage view="routing" />} />
            <Route path="moderation" element={<FeedbackListPage view="moderation" />} />
            <Route path="live-display" element={<LiveDisplayPage />} />
            <Route path="live-display/:entryId" element={<ImportedDetailPage />} />
            <Route path="imports/:jobId/rows/:rowNumber" element={<ImportedDetailPage />} />
            <Route path="unreplied" element={<FeedbackListPage view="unreplied" />} />
            <Route path="replied" element={<Navigate to="/studio/replied/all" replace />} />
            <Route path="replied/all" element={<FeedbackListPage view="replied" />} />
            <Route path="replied/live" element={<FeedbackListPage view="live" />} />
            <Route path="replied/message" element={<FeedbackListPage view="message" />} />
            <Route path="filtered" element={<FeedbackListPage view="filtered" />} />
            <Route path="todo" element={<FeedbackListPage view="todo" />} />
            <Route path="ultra-photos" element={<UltraPhotosPage />} />
            <Route path="search" element={<SearchPage />} />
            <Route path="password" element={<PasswordPage />} />
            <Route path="feedback/:feedbackId" element={<FeedbackDetailPage />} />
            <Route path="user/:userId" element={<UserDetailPage />} />
            <Route path="*" element={<Navigate to="/studio/unreplied" replace />} />
          </Route>
        </Route>
      </Routes>
    </StudioSessionProvider>
  );
}
