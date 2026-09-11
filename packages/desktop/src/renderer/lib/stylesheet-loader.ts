import { THEME_LINK_ID } from "./appearance";

/**
 * Append one stylesheet and resolve after it either loads or degrades. A failed
 * theme stylesheet retries Aqua by changing the SAME link element instead of
 * appending another link with the same id: duplicate IDs make `applyTheme()`
 * update the earlier failed link while the later fallback continues winning the
 * cascade forever.
 */
export function injectStylesheet(href: string, id?: string): Promise<void> {
  return new Promise((resolve) => {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = href;
    if (id) link.id = id;
    link.onload = () => resolve();
    link.onerror = () => {
      // styles.css is Aqua's token file, not a generic fallback. Only the
      // theme link retries with it; failures in other optional CSS stay degraded.
      if (id !== THEME_LINK_ID) {
        resolve();
        return;
      }
      if (href !== "./styles.css") {
        link.onerror = () => {
          console.error("[desktop] failed to load any stylesheet");
          resolve();
        };
        link.href = "./styles.css";
      } else {
        console.error("[desktop] failed to load any stylesheet");
        resolve();
      }
    };
    document.head.appendChild(link);
  });
}
