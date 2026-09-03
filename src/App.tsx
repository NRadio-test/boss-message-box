import { lazy, Suspense } from "react";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { PublicApp } from "./PublicApp";

const StudioApp = lazy(() =>
  import("./features/studio/StudioApp").then((module) => ({ default: module.StudioApp })),
);

export default function App() {
  return (
    <BrowserRouter>
      <Suspense fallback={<div className="route-loading" aria-live="polite">正在打开…</div>}>
        <Routes>
          <Route path="/studio/*" element={<StudioApp />} />
          <Route path="*" element={<PublicApp />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}
