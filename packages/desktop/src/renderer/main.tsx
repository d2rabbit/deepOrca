import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
// Must stay the FIRST import: pre-arms @openuidev/react-lang's DevTools
// auto-mount guard before the SDK is evaluated (see openui/devtools-guard.ts).
import "./openui/devtools-guard";
import { App } from "./App";
import { I18nProvider, useI18n } from "./i18n";
import { MotionProvider } from "./ui/motion";
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
      // styles.css is the Aqua theme's token file, not a generic fallback —
      // only the theme link may retry with it. An OpenUI canvas link failing
      // is the degraded state build.mjs already warns about; appending Aqua
      // tokens after them would silently re-skin the whole window (cascade:
      // last wins) and override the user's chosen theme.
      if (id !== THEME_LINK_ID) {
        resolve();
        return;
      }
      if (href !== "./styles.css") {
        injectStylesheet("./styles.css", id).then(resolve);
      } else {
        // Aqua itself failed — give up and mount bare.
        console.error("[desktop] failed to load any stylesheet");
        resolve();
      }
    };
    document.head.appendChild(link);
  });
}

/** Prototype-window lazy fallback — rendered inside I18nProvider, so it can
 *  localize; the theme stylesheet is injected before render, tokens resolve. */
function PrototypeLoading() {
  const { t } = useI18n();
  return <div style={{ padding: 20, color: "var(--ui-text-faint)" }}>{t("common.loading")}</div>;
}

async function bootstrap(): Promise<void> {
  const { platform } = await api.ready();
  const theme = resolveTheme(platform);
  applyAppearance(resolveAppearance(platform, theme));
  if (theme === "line") applyLineVariant(getStoredLineVariant());
  await Promise.all([
    // Official OpenUI stylesheet (single unlayered copy = token defaults +
    // component rules; the layered/distinct defaults files are redundant —
    // see build.mjs). Loads BEFORE our app css: ui.css last means
    // ui-css/openui-bridge.css re-binds the tokens to DeepOrca's theme
    // system and wins the cascade.
    injectStylesheet("./openui-components.css"),
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
          <MotionProvider>
            <Suspense fallback={<PrototypeLoading />}>
              <PrototypeWindow />
            </Suspense>
          </MotionProvider>
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
            <MotionProvider>
              <App />
            </MotionProvider>
          </ErrorBoundary>
        </I18nProvider>
      </StrictMode>
    );
  }
}

void bootstrap();
