// App icon wiring for the DeepOrca Desktop (orca) client.
//
// The brand icon ships as an SVG (assets/orca-icon.svg → copied to dist/orca-icon.svg
// by build.mjs). Electron's window / taskbar / dock icons need a raster image, and no
// SVG rasterizer is bundled, so we render the SVG to a PNG at runtime using a hidden
// BrowserWindow + canvas (the same technique the icon generator itself uses). The PNG
// is cached under userData so this only happens on the first launch.

import { app, BrowserWindow, nativeImage } from "electron";
import type { NativeImage } from "electron";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ICON_SIZE = 512;

/** Read the bundled SVG (copied next to main.js as dist/orca-icon.svg). */
function readIconSvg(): string | null {
  try {
    return readFileSync(join(__dirname, "orca-icon.svg"), "utf8");
  } catch (error) {
    console.error("[desktop] icon svg missing:", error instanceof Error ? error.message : String(error));
    return null;
  }
}

/**
 * Rasterize an SVG string to a PNG buffer via a hidden BrowserWindow.
 * The offscreen page is loaded from a data: URL (no CSP) and draws the SVG onto
 * a canvas, mirroring the generator's proven downloadPNG path.
 */
async function rasterizeSvgToPng(svg: string, size: number): Promise<Buffer | null> {
  const off = new BrowserWindow({
    width: size,
    height: size,
    show: false,
    frame: false,
    transparent: true,
    webPreferences: { sandbox: false, contextIsolation: true, nodeIntegration: false },
  });
  try {
    const html = `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;padding:0}svg{width:${size}px;height:${size}px;display:block}</style></head><body>${svg}</body></html>`;
    await off.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(html));
    const dataUrl: string = await off.webContents.executeJavaScript(
      `new Promise((resolve, reject) => {
        try {
          const svgEl = document.querySelector("svg");
          const xml = new XMLSerializer().serializeToString(svgEl);
          const img = new Image();
          img.onload = () => {
            const c = document.createElement("canvas");
            c.width = ${size}; c.height = ${size};
            const ctx = c.getContext("2d");
            ctx.clearRect(0, 0, ${size}, ${size});
            ctx.drawImage(img, 0, 0, ${size}, ${size});
            resolve(c.toDataURL("image/png"));
          };
          img.onerror = () => reject(new Error("svg image load failed"));
          img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(xml);
        } catch (e) { reject(e); }
      })`
    );
    const base64 = dataUrl.split(",")[1] ?? "";
    return Buffer.from(base64, "base64");
  } finally {
    off.destroy();
  }
}

let cachedIcon: NativeImage | null = null;

/** Build (or load from cache) the app icon as a NativeImage. Returns null on failure. */
async function loadAppIcon(): Promise<NativeImage | null> {
  if (cachedIcon) {
    return cachedIcon;
  }
  const cacheDir = join(app.getPath("userData"), "icons");
  const cachePath = join(cacheDir, `orca-icon-${ICON_SIZE}.png`);
  try {
    if (existsSync(cachePath)) {
      const image = nativeImage.createFromPath(cachePath);
      if (!image.isEmpty()) {
        cachedIcon = image;
        return image;
      }
    }
  } catch {
    // fall through to re-render
  }

  const svg = readIconSvg();
  if (!svg) {
    return null;
  }
  try {
    const png = await rasterizeSvgToPng(svg, ICON_SIZE);
    if (!png || png.length === 0) {
      return null;
    }
    const image = nativeImage.createFromBuffer(png);
    if (image.isEmpty()) {
      return null;
    }
    try {
      mkdirSync(cacheDir, { recursive: true });
      writeFileSync(cachePath, png);
    } catch {
      // Caching is best-effort; the in-memory image is still usable.
    }
    cachedIcon = image;
    return image;
  } catch (error) {
    console.error("[desktop] icon rasterize failed:", error instanceof Error ? error.message : String(error));
    return null;
  }
}

/**
 * Apply the orca icon to the given window (Windows/Linux taskbar + window frame)
 * and to the macOS dock. Best-effort: silently no-ops if rasterization fails.
 */
export async function applyAppIcon(window: BrowserWindow): Promise<void> {
  const image = await loadAppIcon();
  if (!image) {
    return;
  }
  try {
    if (!window.isDestroyed()) {
      window.setIcon(image);
    }
  } catch {
    // ignore
  }
  try {
    app.dock?.setIcon(image);
  } catch {
    // ignore (non-macOS or unavailable)
  }
}
