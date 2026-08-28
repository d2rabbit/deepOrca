/**
 * A2uiSurface façade (specs/a2ui-integration R2) — renders official v0.9
 * surfaces via `@a2ui/react/v0_9` while keeping the pre-R2 component
 * contract ({messagesJson, surfaceId?, onAction?}) so call sites
 * (A2uiMessage / PrototypePanel / PrototypeWindow / KnowledgePanel /
 * BuildConsolePanel) stay unchanged.
 *
 * Styling comes from two runtime layers, BOTH node-test-safe: the official
 * variable layer via injectBasicCatalogStyles() (no-op outside a document),
 * and the structural stylesheet the app injects as <link> at bootstrap
 * (build.mjs copies it from @a2ui/react/v0_9/index.css — the package's
 * exports map does not expose a css subpath, so a static import is not
 * resolvable by esbuild or Node).
 */

import { useEffect, useState, type JSX } from "react";
import { A2uiSurface as OfficialA2uiSurface } from "@a2ui/react/v0_9";
import { injectBasicCatalogStyles } from "@a2ui/web_core/v0_9";
import { getSurfaceModels, onA2uiAction, processA2uiMessages, a2uiProcessor } from "./processor";
import type { ReactSurfaceModel } from "./processor";
import { useI18n } from "../i18n";

// Official theme variables (CSS custom properties on :root). No-op outside
// a document; guarded for jsdom test environments lacking CSSStyleSheet.
try {
  injectBasicCatalogStyles();
} catch {
  // test environment without constructed-stylesheet support — unstyled is fine
}

type Props = {
  /** Raw A2UI JSON messages from the tool result's embedded resource. */
  messagesJson: string;
  /** Scoped mode: render only this surface. Unscoped renders all. */
  surfaceId?: string;
  /** User-interaction callback (surfaceId, actionName, context). */
  onAction?: (surfaceId: string, actionName: string, context: Record<string, unknown>) => void;
};

export function A2uiSurface({ messagesJson, surfaceId, onAction }: Props): JSX.Element {
  const { t } = useI18n();
  // Feed the batch into the singleton processor whenever it changes.
  useEffect(() => {
    processA2uiMessages(messagesJson);
  }, [messagesJson]);

  // Bridge official actions to the caller (scoped when requested).
  useEffect(() => {
    if (!onAction) return;
    return onA2uiAction((sid, actionName, context) => {
      if (!surfaceId || sid === surfaceId) onAction(sid, actionName, context);
    });
  }, [onAction, surfaceId]);

  // Track surface creation/deletion for list re-renders (content updates are
  // handled inside the official components via their signals binder).
  const [surfaces, setSurfaces] = useState<ReactSurfaceModel[]>(() => getSurfaceModels());
  useEffect(() => {
    const sync = (): void => setSurfaces(getSurfaceModels());
    const created = a2uiProcessor.onSurfaceCreated(sync);
    const deleted = a2uiProcessor.onSurfaceDeleted(sync);
    return () => {
      created.unsubscribe();
      deleted.unsubscribe();
    };
  }, []);

  const visible = surfaceId ? surfaces.filter((s) => s.id === surfaceId) : surfaces;

  if (visible.length === 0) {
    return <div className="ui-a2ui-empty">{t("common.loading")}</div>;
  }
  return (
    <div className="ui-a2ui-surfaces ui-a2ui-theme">
      {visible.map((surface) => (
        <OfficialA2uiSurface key={surface.id} surface={surface} />
      ))}
    </div>
  );
}
