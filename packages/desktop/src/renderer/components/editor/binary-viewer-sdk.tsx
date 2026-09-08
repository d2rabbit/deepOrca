/**
 * SDK mount for BinaryFileViewer — isolated in its own lazy chunk so the
 * preview SDK (and its dynamically-imported format parsers) only load when a
 * binary preview actually mounts (specs/artifact-landing 链路 A; A6: the
 * plugin array is a constant, so tree-shaking drops unmounted format engines
 * and the build guard fails the bundle if three/leaflet/hls.js leak in).
 */

import { type JSX } from "react";
import { archivePlugin, fallbackPlugin, imagePlugin, officePlugin, pdfPlugin } from "@open-file-viewer/core";
import { FileViewer } from "@open-file-viewer/react";
import type { Locale } from "../../i18n";

// pdf.worker.min.mjs is copied next to index.html at build time (build.mjs) —
// a same-dir relative URL keeps the preview fully offline (A5, no CDN).
const PLUGINS = [
  pdfPlugin({ workerSrc: "pdf.worker.min.mjs" }),
  officePlugin(),
  imagePlugin(),
  archivePlugin(),
  fallbackPlugin(),
];

/** The SDK ships only two built-in locale packs (PreviewLocale); locale comes
 *  from the i18n context — the old documentElement.lang read was dead (nothing
 *  writes it). zh-TW/zh-HK map to the Simplified zh-CN pack (closer than
 *  English); ja/ko use the English pack until a full PreviewMessages override
 *  lands (A4 follow-up). */
function sdkLocale(locale: Locale): "zh-CN" | "en-US" {
  return locale.startsWith("zh") ? "zh-CN" : "en-US";
}

function BinarySdkViewer({
  bytes,
  name,
  locale,
  appearance,
}: {
  bytes: ArrayBuffer;
  name: string;
  locale: Locale;
  appearance: "light" | "dark";
}): JSX.Element {
  return (
    <FileViewer
      key={name}
      file={bytes}
      fileName={name}
      width="100%"
      height="100%"
      fit="contain"
      theme={appearance}
      locale={sdkLocale(locale)}
      plugins={PLUGINS}
      toolbar
    />
  );
}

export default BinarySdkViewer;
