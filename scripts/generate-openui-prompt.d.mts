/** Types for generate-openui-prompt.mjs (typed twin so TS consumers can import it). */

/** Build the component prompt from the real designer library schema. */
export declare function buildDesignerPrompt(): Promise<string>;

/** Replace the SKILL.md component-table section with the generated prompt. */
export declare function applyPromptToSkill(skillMd: string, prompt: string): string;

/** Render the generated validator schema module (prettier-stable output). */
export declare function buildLibrarySchemaModule(): Promise<string>;

export declare const SKILL_PATH: string;

/** Path of the generated a2ui/openui-library-schema.ts artifact. */
export declare const SCHEMA_PATH: string;
