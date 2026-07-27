import type { DesktopApi } from "../shared/ipc";

declare global {
  interface Window {
    deeporca: DesktopApi;
  }
}

export const api: DesktopApi = window.deeporca;
