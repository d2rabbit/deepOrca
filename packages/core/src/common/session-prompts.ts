/**
 * Localized session task/status prompts — the user-visible strings the
 * engine appends below turns (plan-mode toggles, compaction notices, retry
 * banners, request failures). Core stays UI-free: the catalog carries its
 * own zh/en table and the HOST injects the active locale at boot
 * (`configureSessionLocale`); unknown locales fall back to English.
 *
 * Wording is deliberately plain/direct — these ride under a message, not in
 * a log. Params use {name} substitution.
 */

export type SessionPromptKey =
  | "planModeOn"
  | "planModeOff"
  | "compacting"
  | "compactRetryContextWindow"
  | "compactRetryStalled"
  | "requestFailed"
  | "apiKeyMissing"
  | "apiKeyMissingShort"
  | "modelChanged";

export type SessionPromptLocale = "en" | "zh";

const CATALOG: Record<SessionPromptKey, Record<SessionPromptLocale, string>> = {
  planModeOn: {
    en: "  └ Plan mode on — read-only planning. Awaiting <proposed_plan>.",
    zh: "  └ 计划模式已开启：仅做只读规划，等待 <proposed_plan> 方案。",
  },
  planModeOff: {
    en: "  └ Plan mode off.",
    zh: "  └ 计划模式已关闭。",
  },
  compacting: {
    en: "Context is getting long — compacting the conversation…",
    zh: "对话较长，正在压缩上下文……",
  },
  compactRetryContextWindow: {
    en: "Context window exceeded — compacting history and retrying once…",
    zh: "已超出上下文窗口：正在压缩历史记录并重试一次……",
  },
  compactRetryStalled: {
    en: "The model stream stalled — retrying the request…",
    zh: "模型响应停滞，正在重试请求……",
  },
  requestFailed: {
    en: "Request failed: {message}",
    zh: "请求失败：{message}",
  },
  apiKeyMissing: {
    en: "No API key configured. Add one in Settings, or set it in {userPath} / {projectPath}.",
    zh: "尚未配置 API Key：请在设置中填写，或写入 {userPath} / {projectPath}。",
  },
  apiKeyMissingShort: {
    en: "No API key configured. Add one in Settings first.",
    zh: "尚未配置 API Key：请先在设置中填写。",
  },
  modelChanged: {
    en: "Model set to {model} ({mode})",
    zh: "模型已切换：{model}（{mode}）",
  },
};

let activeLocale: SessionPromptLocale = "en";

/** Host-injected locale (desktop calls this at boot and on locale change). */
export function configureSessionLocale(locale: string | undefined): void {
  activeLocale = locale && locale.toLowerCase().startsWith("zh") ? "zh" : "en";
}

export function getSessionLocale(): SessionPromptLocale {
  return activeLocale;
}

/** Format a session prompt for the active locale ({name} substitution). */
export function formatSessionPrompt(key: SessionPromptKey, params?: Record<string, string>): string {
  let text = CATALOG[key][activeLocale];
  if (params) {
    for (const [name, value] of Object.entries(params)) {
      text = text.split(`{${name}}`).join(value);
    }
  }
  return text;
}

/** Thinking-mode suffix for the model-changed notice. */
export function formatThinkingModeLabel(thinkingEnabled: boolean, effort: string): string {
  if (!thinkingEnabled) return activeLocale === "zh" ? "思考已关闭" : "no thinking";
  return effort;
}
