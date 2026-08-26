import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { I18nProvider } from "./i18n";
import { api } from "./api";
import { lazy, Suspense } from "react";

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
import { resetLayoutToClassic, resolveLayout } from "./lib/layout";

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
  // Experimental Orca Deck layout: load its chunk + stylesheets instead of the
  // classic shell. All six theme sheets load up-front — each is a token block
  // scoped to data-deck-theme, so switching themes is a zero-reload attribute
  // flip. On ANY failure (missing chunk after an update, broken build) persist
  // classic and fall through — the fallback must not depend on the user
  // finding their way back.
  if (!isPrototypeWindow && resolveLayout() === "deck") {
    try {
      const { DeckApp } = await import("./deck/deck-app");
      await Promise.all([
        injectStylesheet("./deck/deck-tokens.css"),
        ...["liquid", "flat", "glass", "neu", "clay", "vern"].map((theme) =>
          injectStylesheet(`./deck/themes/${theme}.css`)
        ),
        injectStylesheet("./deck/deck.css"),
      ]);
      createRoot(container!).render(
        <StrictMode>
          <I18nProvider>
            <DeckApp />
          </I18nProvider>
        </StrictMode>
      );
      return;
    } catch (err) {
      console.error("[desktop] deck layout failed to load, falling back to classic", err);
      resetLayoutToClassic();
    }
  }

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
          <App />
        </I18nProvider>
      </StrictMode>
    );
  }
}

void bootstrap();
