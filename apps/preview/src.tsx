import { createRoot } from "react-dom/client";
import { StrictMode, lazy, Suspense } from "react";
import "../../packages/ui/src/tokens.css";
const Admin = lazy(() => import("../admin/src/events/AdminPreview"));
const ConnectedAdmin = lazy(() => import("../admin/src/events/AdminApp"));
const ConnectedPublic = lazy(() => import("../public/src/events/PublicApp"));
const Public = lazy(() => import("../public/src/events/PublicPreview"));
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Suspense
      fallback={<p className="empty-state">화면을 준비하고 있습니다.</p>}
    >
      {location.pathname.startsWith("/admin") ? (!new URLSearchParams(location.search).has("design") ? <ConnectedAdmin /> : <Admin />) : (!new URLSearchParams(location.search).has("design") ? <ConnectedPublic /> : <Public />)}
    </Suspense>
  </StrictMode>,
);
