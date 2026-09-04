// Multilingual message catalog for the desktop renderer. `en` is the source of
// truth (locales/en.ts); every other locale is a `Record<MessageKey, string>`
// (completeness is enforced by the type) in its sibling locale file. Values may
// contain `{name}`/`{n}` placeholders that are substituted at call time.

import { en } from "./locales/en.js";
import { zh } from "./locales/zh.js";
import { zhTW } from "./locales/zh-tw.js";
import { zhHK } from "./locales/zh-hk.js";
import { ja } from "./locales/ja.js";
import { ko } from "./locales/ko.js";

export type MessageKey = keyof typeof en;
export type Locale = "en" | "zh" | "zh-TW" | "zh-HK" | "ja" | "ko";

export const messages: Record<Locale, Record<MessageKey, string>> = {
  en,
  zh,
  "zh-TW": zhTW,
  "zh-HK": zhHK,
  ja,
  ko,
};
