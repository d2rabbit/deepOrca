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

// pdf.worker.min.mjs is copied next to index.html at build time (build.mjs) —
// a same-dir relative URL keeps the preview fully offline (A5, no CDN).
const PLUGINS = [
  pdfPlugin({ workerSrc: "pdf.worker.min.mjs" }),
  officePlugin(),
  imagePlugin(),
  archivePlugin(),
  fallbackPlugin(),
];

function BinarySdkViewer({ bytes, name }: { bytes: ArrayBuffer; name: string }): JSX.Element {
  const appearance = document.documentElement.dataset.appearance === "dark" ? "dark" : "light";
  const lang = document.documentElement.lang || "";
  const locale = lang.startsWith("zh") ? "zh-CN" : "en-US";
  return (
    <FileViewer
      key={name}
      file={bytes}
      fileName={name}
      width="100%"
      height="100%"
      fit="contain"
      theme={appearance}
      locale={locale}
      plugins={PLUGINS}
      toolbar
    />
  );
}

export default BinarySdkViewer;
