import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import prettierConfig from "eslint-config-prettier";

export default tseslint.config(
  // Not our code — upstream sources vendored verbatim. Linting them only produces
  // style noise we must not "fix": every local edit widens the drift from upstream
  // and makes the next sync harder to reason about.
  {
    ignores: [
      // Built-in plugin packages carry upstream skill scripts. (Replaces
      // `templates/skills/bundled/**`, a path that no longer exists since the
      // bundled skills moved into templates/plugins/<pkg>/skills/.)
      "packages/core/templates/plugins/**",
      // TDAI Core fork — see packages/memory/src/NOTICE.md. ~17k LOC copied from
      // TencentDB-Agent-Memory; its warnings are all upstream style (unused type
      // imports, `import()` annotations), not defects.
      "packages/memory/src/tdai/**",
    ],
  },
  // Base recommended rules from ESLint
  js.configs.recommended,
  // TypeScript recommended rules
  ...tseslint.configs.recommended,
  // Custom project rules
  {
    rules: {
      // Desktop project allows console
      "no-console": "off",
      // Allow dynamic require for package.json
      "@typescript-eslint/no-var-requires": "off",
      "@typescript-eslint/no-require-imports": "off",
      // Allow control regex for ANSI stripping (markdown.test.ts)
      "no-control-regex": "off",
      // Enforce consistent type imports
      "@typescript-eslint/consistent-type-imports": "warn",
      // Unused vars: allow _-prefixed parameters
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          destructuredArrayIgnorePattern: "^_",
        },
      ],
    },
  },
  // React hooks rules
  {
    plugins: {
      "react-hooks": reactHooks,
    },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
    },
  },
  // Test files: relaxed rules
  {
    files: ["packages/*/src/tests/**/*.ts", "packages/*/src/tests/**/*.mjs"],
    languageOptions: {
      globals: {
        process: "readonly",
        console: "readonly",
      },
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": "off",
    },
  },
  // Script files: Node.js environment
  {
    files: ["./scripts/**/*.js", "./scripts/**/*.mjs", "packages/*/scripts/**/*.js", "packages/*/build.mjs"],
    languageOptions: {
      globals: {
        process: "readonly",
        console: "readonly",
        fetch: "readonly",
        AbortSignal: "readonly",
        AbortController: "readonly",
      },
    },
  },
  // Statusline plugins: Node.js environment
  {
    files: [
      ".deeporca/plugins/**/*.mjs",
      ".deeporca/plugins/**/*.js",
      ".deepcode/plugins/**/*.mjs",
      ".deepcode/plugins/**/*.js",
    ],
    languageOptions: {
      globals: {
        process: "readonly",
        console: "readonly",
      },
    },
  },
  // Browser resources: webview scripts
  {
    files: ["packages/*/resources/**/*.js"],
    languageOptions: {
      globals: {
        window: "readonly",
        document: "readonly",
        console: "readonly",
        FileReader: "readonly",
        Blob: "readonly",
        URL: "readonly",
        fetch: "readonly",
      },
    },
  },
  // Prettier config: disable conflicting ESLint rules, MUST be last
  prettierConfig
);
