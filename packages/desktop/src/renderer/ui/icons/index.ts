/**
 * Central SVG icon library for the desktop renderer.
 *
 * Every hand-authored SVG icon in the desktop package lives in THIS directory
 * — one module per category, re-exported here as the single import surface
 * (`import { IconX } from "../ui/icons"`). Do not inline new `<svg>` glyphs in
 * components; add them to the matching category module instead. Data-driven
 * SVG canvases (graph boards, progress rings, diagram previews) are not icons
 * and stay next to their owning component.
 *
 * Categories:
 *  - rail      — primary navigation (activity rail, panel tabs)
 *  - welcome   — welcome-screen quick-start chips
 *  - tools     — per-tool-family glyphs for the conversation flow
 *  - common    — shared UI glyphs (status, actions, file-tree shapes, …)
 *  - window    — window caption controls (min/max-restore/close)
 *  - file-type — colored file/directory badges + iconic-file mini-glyphs
 *  - presets   — shared svg attribute bundles (size/viewBox) per category
 */

// Primary navigation (activity rail, panel tabs).
export {
  IconNewSession,
  IconSessions,
  IconGit,
  IconTasks,
  IconCommand,
  IconPlugins,
  IconTokens,
  IconIndex,
  IconReview,
  IconDesign,
  IconPrototype,
  IconTaskTree,
  IconGitmcp,
  IconMoon,
  IconSun,
  IconUndo,
  IconSettings,
} from "./rail";

// Welcome-screen quick-start chips.
export {
  IconWelcomePlan,
  IconWelcomeInit,
  IconWelcomeSkills,
  IconWelcomeUndo,
  IconWelcomeKnowledge,
  IconWelcomeReview,
} from "./welcome";

// Per-tool-family glyphs (conversation flow avatars).
export {
  IconToolRead,
  IconToolWrite,
  IconToolEdit,
  IconToolAsk,
  IconToolPlan,
  IconToolSearch,
  IconToolMcp,
  IconToolGeneric,
  IconBashTerminal,
} from "./tools";

// Shared UI glyphs.
export {
  IconChat,
  IconEditor,
  IconMagicWand,
  IconFolder,
  IconFile,
  IconFolderOutline,
  IconFileOutline,
  IconPlus,
  IconInfo,
  IconClock,
  IconTrash,
  IconWarn,
  IconLock,
  IconFlame,
  IconBalance,
  IconPalette,
  IconBolt,
  IconCheck,
  IconBook,
  IconPencil,
  IconMenuBars,
  IconClose,
  IconExternal,
  IconTaskHub,
  IconChatBubble,
  IconBot,
  IconShield,
  IconSparkle,
  IconList,
  IconTerminal,
  IconSlashCommand,
  IconChevronDown,
  IconRefresh,
  IconPulse,
  IconBrain,
} from "./common";

// Window caption controls.
export { IconWindowMin, IconWindowMaxRestore, IconWindowClose } from "./window";

// File/directory type badges (language labels + iconic-file mini-glyphs).
export { FileIcon, DirIcon } from "./file-type";
