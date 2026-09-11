export const THEME_LINK_ID = "deeporca-theme-css";

let requestSeq = 0;

type ThemeLinkState = {
  seq: number;
  href: string;
  settled: boolean;
};

function currentLink(): HTMLLinkElement | null {
  return document.getElementById(THEME_LINK_ID) as HTMLLinkElement | null;
}

function bindThemeLink(link: HTMLLinkElement, href: string, append: boolean): Promise<void> {
  const state: ThemeLinkState = { seq: ++requestSeq, href, settled: false };
  link.dataset.themeRequestSeq = String(state.seq);
  link.dataset.themeRequestHref = href;
  link.dataset.themeLoaded = "false";
  link.rel = "stylesheet";

  const promise = new Promise<void>((resolve) => {
    const resolveOnce = (): void => {
      if (state.settled) return;
      state.settled = true;
      resolve();
    };
    const isCurrent = (): boolean => currentLink() === link && link.dataset.themeRequestSeq === String(state.seq);

    link.onload = () => {
      if (isCurrent()) link.dataset.themeLoaded = "true";
      resolveOnce();
    };
    link.onerror = () => {
      if (!isCurrent()) {
        resolveOnce();
        return;
      }
      if (state.href !== "./styles.css") {
        void bindThemeLink(link, "./styles.css", false).then(resolveOnce);
        return;
      }
      console.error("[desktop] failed to load any stylesheet");
      resolveOnce();
    };
  });

  link.href = href;
  if (append) document.head.appendChild(link);
  return promise;
}

export function injectThemeStylesheet(href: string): Promise<void> {
  const link = document.createElement("link");
  link.id = THEME_LINK_ID;
  return bindThemeLink(link, href, true);
}

/** Switch the single theme link without allowing an in-flight old request to win. */
export function switchThemeStylesheet(href: string): void {
  const link = currentLink();
  if (!link) return;
  if (link.dataset.themeRequestHref === href && link.dataset.themeLoaded === "true") return;

  if (link.dataset.themeLoaded === "true") {
    void bindThemeLink(link, href, false);
    return;
  }

  const replacement = document.createElement("link");
  replacement.id = THEME_LINK_ID;
  link.replaceWith(replacement);
  void bindThemeLink(replacement, href, false);
}

export function themeLinkRequestSeq(): number {
  return requestSeq;
}
