/**
 * BinaryFileViewer — in-place fallback preview when cm6 can't open a file
 * (specs/artifact-landing 链路 A). Reads bytes over the containment-checked
 * binary IPC and mounts the preview SDK lazily; anything not whitelisted
 * gets a clear reason plus the system-open escape hatch (A3) — media streams
 * and special formats are deliberately not previewed.
 *
 * This wrapper is deliberately light: the SDK + parsers live in
 * `binary-viewer-sdk.tsx` (React.lazy) so the editor's main bundle never
 * carries them (A6, build-guard asserted).
 */

import { lazy, Suspense, useEffect, useState, type JSX } from "react";
import { api } from "../../api";
import { useI18n } from "../../i18n";
import { IconWarn } from "../../ui/index";

const BinarySdkViewer = lazy(() => import("./binary-viewer-sdk"));

type ReadState =
  | { status: "loading" }
  | { status: "ready"; bytes: ArrayBuffer; name: string; ext: string }
  | { status: "fallback"; message: string };

/** Inject the SDK stylesheet once (build-time copy, see build.mjs). */
function ensureSdkStyles(): void {
  if (document.getElementById("ofv-core-css")) return;
  const link = document.createElement("link");
  link.id = "ofv-core-css";
  link.rel = "stylesheet";
  link.href = "ofv-core.css";
  document.head.appendChild(link);
}

export function BinaryFileViewer({ file, appearance }: { file: string; appearance: "light" | "dark" }): JSX.Element {
  const { t, locale } = useI18n();
  const [state, setState] = useState<ReadState>({ status: "loading" });

  useEffect(() => {
    let alive = true;
    setState({ status: "loading" });
    api
      .editorReadBinary(file)
      .then((res) => {
        if (!alive) return;
        if (res.ok && res.bytes && res.name && res.ext) {
          // Copy into an exact ArrayBuffer (IPC may back the view with a
          // pooled buffer) and reset the SDK so a new file re-mounts clean.
          const copy = new Uint8Array(res.bytes.byteLength);
          copy.set(res.bytes);
          setState({ status: "ready", bytes: copy.buffer as ArrayBuffer, name: res.name, ext: res.ext });
        } else {
          const reason = res.reason;
          const message =
            reason === "extension-unsupported"
              ? t("editor.preview.unsupported")
              : reason === "too-large"
                ? t("editor.preview.tooLarge")
                : t("editor.preview.unavailable");
          setState({ status: "fallback", message });
        }
      })
      .catch((cause: unknown) => {
        if (alive) {
          setState({
            status: "fallback",
            message: t("editor.preview.failed", { error: cause instanceof Error ? cause.message : String(cause) }),
          });
        }
      });
    return () => {
      alive = false;
    };
  }, [file, t]);

  useEffect(ensureSdkStyles, []);

  if (state.status === "loading") {
    return (
      <div className="ui-editor-binary">
        <div className="ui-editor-binary-state">
          <span className="ui-spinner" /> {t("editor.preview.loading")}
        </div>
      </div>
    );
  }
  if (state.status === "fallback") {
    return (
      <div className="ui-editor-binary">
        <div className="ui-editor-binary-state">
          <IconWarn />
          <p>{state.message}</p>
          <button type="button" onClick={() => void api.editorOpenSystem(file)}>
            {t("editor.preview.openSystem")}
          </button>
        </div>
      </div>
    );
  }
  return (
    <div className="ui-editor-binary">
      <Suspense
        fallback={
          <div className="ui-editor-binary-state">
            <span className="ui-spinner" /> {t("editor.preview.loading")}
          </div>
        }
      >
        <BinarySdkViewer bytes={state.bytes} name={state.name} locale={locale} appearance={appearance} />
      </Suspense>
    </div>
  );
}
