import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { I18nProvider } from "./i18n";
import { api } from "./api";
import { lazy, Suspense } from "react";
import { ErrorBoundary } from "./components/ErrorBoundary";

// Window-level crash fence: uncaught errors and unhandled rejections outside
// React's reach (effects, event callbacks) previously only surfaced in the
// DevTools console — give them a loud, greppable prefix as well.
window.addEventListener("error", (event) => {
  console.error("[ui:error]", event.error ?? event.message);
});
window.addEventListener("unhandledrejection", (event) => {
  console.error("[ui:unhandledrejection]", event.reason);
});

// Check if this window was opened as a standalone prototype preview.
const urlParams = new URLSearchParams(window.location.search);
const isPrototypeWindow = urlParams.get("view") === "prototype";

// Lazy-load the standalone prototype renderer (only for popout windows).
const PrototypeWindow = lazy(() =>
  import("./components/PrototypeWindow").then((m) => ({ default: m.PrototypeWindow }))
);
import {
  applyAppearance,
  applyLineVariant,
  getStoredLineVariant,
  resolveAppearance,
  resolveTheme,
  themeStylesheet,
  THEME_LINK_ID,
} from "./lib/appearance";

const container = document.getElementById("root");
if (!container) {
  throw new Error("Root element #root not found");
}

function injectStylesheet(href: string, id?: string): Promise<void> {
  return new Promise((resolve) => {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = href;
    if (id) link.id = id;
    link.onload = () => resolve();
    link.onerror = () => {
      // 回退到 Aqua 主题,保证页面不裸奔
      if (href !== "./styles.css") {
        injectStylesheet("./styles.css", id).then(resolve);
      } else {
        // 连 Aqua 都加载失败,认命,直接 mount
        console.error("[desktop] failed to load any stylesheet");
        resolve();
      }
    };
    document.head.appendChild(link);
  });
}

async function bootstrap(): Promise<void> {
  const { platform } = await api.ready();
  const theme = resolveTheme(platform);
  applyAppearance(resolveAppearance(platform, theme));
  if (theme === "line") applyLineVariant(getStoredLineVariant());
  await Promise.all([
    injectStylesheet("./ui.css"),
    // Official A2UI basic-catalog structural styles (copied by build.mjs).
    injectStylesheet("./a2ui-basic.css"),
    injectStylesheet(themeStylesheet(theme), THEME_LINK_ID),
  ]);

  if (isPrototypeWindow) {
    // Standalone prototype window — render only the prototype surface.
    createRoot(container!).render(
      <StrictMode>
        <I18nProvider>
          <Suspense fallback={<div style={{ padding: 20, color: "#888" }}>Loading prototype…</div>}>
            <PrototypeWindow />
          </Suspense>
        </I18nProvider>
      </StrictMode>
    );
  } else {
    createRoot(container!).render(
      <StrictMode>
        <I18nProvider>
          {/* Root fence: an exception during App render/effects unmounted the
              entire tree (black window + manual restart). Contain it to the
              built-in error card with retry instead. */}
          <ErrorBoundary>
            <App />
          </ErrorBoundary>
        </I18nProvider>
      </StrictMode>
    );
  }
}

void bootstrap();
