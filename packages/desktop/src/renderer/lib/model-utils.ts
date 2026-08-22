/**
 * Browser-safe model key utilities. The key/registration helpers mirror the
 * pure-JS functions from @deeporca/core/settings.ts without pulling in Node.js
 * built-ins (fs, path, child_process) that would break the renderer (browser)
 * esbuild bundle; the capability fallback now imports the model family
 * registry directly via the dependency-free `@deeporca/core/capabilities`
 * subpath, so there is a single source of truth.
 */

import { defaultsToThinkingMode, supportsMultimodal } from "@deeporca/core/capabilities";
import type { MessageKey } from "../i18n";

/**
 * i18n label key for a unified thinking tier: low/medium/high/xhigh/max →
 * model.thinkingLow / …Medium / …High / …Xhigh / …Max (keys carry the
 * localized tier name with the English tier in parentheses).
 */
export function thinkingLabelKey(level: string): MessageKey {
  const cap = level === "xhigh" ? "Xhigh" : level[0]!.toUpperCase() + level.slice(1);
  return `model.thinking${cap}` as MessageKey;
}

export type ModelRegistration = {
  id: string;
  thinking?: boolean;
  vision?: boolean;
};

export type EndpointLike = {
  id: string;
  models?: ModelRegistration[];
};

export function buildModelKey(endpointId: string, modelId: string): string {
  return `${endpointId}/${modelId}`;
}

export function parseModelKey(key: string): { endpointId: string; modelId: string } | null {
  const idx = key.indexOf("/");
  if (idx <= 0 || idx >= key.length - 1) return null;
  return { endpointId: key.slice(0, idx), modelId: key.slice(idx + 1) };
}

export function collectAllModelKeys(endpoints: ReadonlyArray<EndpointLike>): string[] {
  // Dedupe: the same model id registered twice on one endpoint (hand-edited
  // settings file) must not produce duplicate select options / React keys.
  const seen = new Set<string>();
  for (const ep of endpoints) {
    for (const model of ep.models ?? []) {
      seen.add(buildModelKey(ep.id, model.id));
    }
  }
  return [...seen];
}

export function resolveModelCapability(
  endpoints: ReadonlyArray<EndpointLike>,
  modelKey: string
): { thinking: boolean; vision: boolean } {
  const parsed = parseModelKey(modelKey);
  if (parsed) {
    const ep = endpoints.find((e) => e.id === parsed.endpointId);
    const reg = ep?.models?.find((m) => m.id === parsed.modelId);
    if (reg) {
      return {
        thinking: reg.thinking ?? false,
        vision: reg.vision ?? false,
      };
    }
  }
  const modelId = parsed?.modelId ?? modelKey;
  return {
    thinking: defaultsToThinkingMode(modelId),
    vision: supportsMultimodal(modelId),
  };
}
