/**
 * Browser-safe model key utilities — mirrors the pure-JS functions from
 * @deeporca/core/settings.ts without pulling in Node.js built-ins (fs, path,
 * child_process) that would break the renderer (browser) esbuild bundle.
 *
 * If the core versions change, update these to match.
 */

export type ModelRegistration = {
  id: string;
  thinking?: boolean;
  vision?: boolean;
};

export type EndpointLike = {
  id: string;
  models?: ModelRegistration[];
};

const DEEPSEEK_V4_MODELS = new Set(["deepseek-v4-flash", "deepseek-v4-pro"]);

const NON_MULTIMODAL_MODELS = new Set(["deepseek-v4-pro", "deepseek-v4-flash", "deepseek-chat", "deepseek-reasoner"]);

export function buildModelKey(endpointId: string, modelId: string): string {
  return `${endpointId}/${modelId}`;
}

export function parseModelKey(key: string): { endpointId: string; modelId: string } | null {
  const idx = key.indexOf("/");
  if (idx <= 0 || idx >= key.length - 1) return null;
  return { endpointId: key.slice(0, idx), modelId: key.slice(idx + 1) };
}

export function collectAllModelKeys(endpoints: ReadonlyArray<EndpointLike>): string[] {
  const keys: string[] = [];
  for (const ep of endpoints) {
    for (const model of ep.models ?? []) {
      keys.push(buildModelKey(ep.id, model.id));
    }
  }
  return keys;
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
    thinking: DEEPSEEK_V4_MODELS.has(modelId),
    vision: !NON_MULTIMODAL_MODELS.has(modelId.trim()),
  };
}
