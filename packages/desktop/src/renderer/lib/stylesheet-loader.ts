import { THEME_LINK_ID, injectThemeStylesheet } from "./theme-link";

/** Append one stylesheet and recover through the same DOM link on failure. */
export function injectStylesheet(href: string, id?: string): Promise<void> {
  if (id === THEME_LINK_ID) return injectThemeStylesheet(href);

  return new Promise((resolve) => {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = href;
    link.onload = () => resolve();
    link.onerror = () => resolve();
    document.head.appendChild(link);
  });
}
