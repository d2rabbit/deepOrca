# Vendored: OpenUI official agent skill

Imported wholesale from the official OpenUI agent-skill repository —
`https://github.com/thesysdev/skills` (`skills/openui/`, fetched as
`skills-main.zip` on 2026-09-07). Do not edit the imported files by hand;
refresh them from upstream when needed ("视情况更新") and keep this notice.

## Local deviations (re-apply after refreshing from upstream)

- SKILL.md frontmatter adds `metadata: allow-implicit-invocation: false` —
  the official skill is an implicit-invocation match candidate on every
  session; DeepOrca wants it consulted only on explicit reference (the
  mechanism is honored by DeepOrca's skill loader).
- `npx @openuidev/cli@latest` commands are pinned to `@0.2.12` (latest
  published CLI at vendoring time) so guidance doesn't float to unreviewed
  upstream releases.

The `pm-designer-openui` sibling skill is DeepOrca's prototype-authoring
pipeline (render_openui tool flow). This vendored `openui` skill is the
official reference for OpenUI Lang itself — syntax, runtimes, component
libraries, ThemeProvider, reliability practices, and the @openuidev package
map — and is consulted by design agents for integration-level questions.

Telemetry note (verified against `@openuidev/lang-core@0.2.17` dist):
the SDK's postinstall telemetry is disabled with `OPENUI_TELEMETRY_DISABLED=1`
or `DO_NOT_TRACK=1`; runtime telemetry is off unless
`OPENUI_RUNTIME_TELEMETRY_ENABLED` is set explicitly.
