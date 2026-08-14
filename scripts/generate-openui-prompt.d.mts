/** Types for generate-openui-prompt.mjs (typed twin so TS consumers can import it). */

/** Build the component prompt from the real designer library schema. */
export declare function buildDesignerPrompt(): Promise<string>;

/** Replace the SKILL.md component-table section with the generated prompt. */
export declare function applyPromptToSkill(skillMd: string, prompt: string): string;

export declare const SKILL_PATH: string;
