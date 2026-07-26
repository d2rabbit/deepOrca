import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { I18nProvider } from "./i18n";
import { api } from "./api";
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
  // Shared primitive stylesheet first (theme-agnostic structure + token
  // fallbacks), then the resolved theme file (Aqua / Metro / Glass) which binds
  // --ui-*. The theme link carries a stable id so it can be swapped at runtime.
  await injectStylesheet("./ui.css");
  await injectStylesheet(themeStylesheet(theme), THEME_LINK_ID);
  createRoot(container!).render(
    <StrictMode>
      <I18nProvider>
        <App />
      </I18nProvider>
    </StrictMode>
  );
}

void bootstrap();
