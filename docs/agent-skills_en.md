# Agent Skills

## Overview

A good skill is useful when the instruction set is:

- Reused across tasks, such as code review, release preparation, or report generation
- Too long or detailed to paste into every prompt
- Backed by resources, such as templates, scripts, schemas, examples, or reference docs
- Triggered by a clear situation, such as "process a PDF form" or "create a database migration for this project"

Do not use a skill for:

- One-off task requirements
- Short repository rules, which usually belong in `AGENTS.md`
- Live external actions, which usually belong in MCP tools

## Scan Locations

DeepOrca CLI scans skills in the following order. If multiple skills resolve to the same `name`, only the highest-priority one is kept.

| Priority | Scope   | Path                  | Purpose |
| -------- | ------- | --------------------- | ------- |
| 1        | Project | `./.deeporca/skills/` | Native DeepOrca project skills |
| 2        | Project | `./.agents/skills/`   | Project skills shared with other agent clients |
| 3        | User    | `~/.deeporca/skills/` | Native DeepOrca user skills |
| 4        | User    | `~/.agents/skills/`   | User skills shared with other agent clients |
| 5        | Global  | `built-in`            | Skills bundled with DeepOrca |

Example structure:

```text
.deeporca/
└── skills/
    └── code-review/
        ├── SKILL.md
        ├── checklist.md
        └── scripts/
            └── collect-diff.sh
```

## Minimal Skill

Each skill must live in its own directory and contain `SKILL.md`.

```markdown
---
name: code-review
description: Review code changes for correctness, regressions, security risks, and missing tests. Use when the user asks for a review, PR review, diff review, or pre-merge check.
---

# Code Review

Use a code review mindset. Prioritize bugs, behavioral regressions, security issues,
and missing tests over style comments.

## Workflow

1. Inspect the diff and relevant surrounding code.
2. List findings first, ordered by severity.
3. Include file and line references for every finding.
4. If there are no findings, say so and mention residual risks or test gaps.
```

## `SKILL.md` Frontmatter

DeepOrca CLI reads YAML frontmatter at the top of `SKILL.md`.

| Field | Required | DeepOrca behavior | Recommendation |
| ----- | -------- | ------------------ | -------------- |
| `name` | Recommended | Used as the unique skill name. If missing, DeepOrca uses the directory name and converts `_` to `-`. | Use lowercase letters, numbers, and hyphens. Keep it aligned with the directory name. |
| `description` | Recommended | Used for automatic matching and shown in `/skills` and the slash menu. | Describe what the skill does, when to use it, and common trigger terms. |
| `metadata.allow-implicit-invocation` | Optional | When set to `false`, the skill is excluded from automatic matching but can still be selected manually. | Use for manual-only skills. |

Example:

```yaml
---
name: db-migration
description: Create and review database migrations for this project. Use when the user asks to add columns, change schema, write migrations, or validate rollback behavior.
metadata:
  allow-implicit-invocation: false
---
```

> DeepOrca CLI currently interprets only the fields listed above. Other frontmatter fields may be useful for cross-client compatibility or documentation, but they do not automatically restrict DeepOrca tool permissions.

## Write a Strong `description`

The `description` is the most important discovery signal. During automatic matching, DeepOrca gives the model only each skill's `name` and `description`, so specific descriptions match more reliably.

Recommended pattern:

```text
<What this skill does>. Use when <task types, file types, domain, user phrases, or trigger terms>.
```

Good examples:

```yaml
description: Extract tables from PDF files, fill PDF forms, and merge documents. Use when working with PDFs, forms, invoices, statements, or document extraction.
```

```yaml
description: Generate Lessweb routes, services, and Pydantic request models. Use when editing Lessweb projects, adding @Get/@Post endpoints, configuring IOC modules, or updating OpenAPI output.
```

Avoid:

```yaml
description: Helps with documents
description: Useful project skill
description: Tooling instructions
```

Checklist:

- State the concrete capability, not only the topic
- State when to use it, not only the expected result
- Include terms users are likely to type
- Include relevant file types, framework names, command names, or domain names
- Avoid overbroad wording that triggers on unrelated tasks

## Skill Body Structure

The body of `SKILL.md` should be written for an agent, not for a general reader. Keep it direct, actionable, and verifiable.

Recommended structure:

```markdown
# Skill Name

Briefly state what this skill is for.

## When to use

- Use when ...
- Do not use when ...

## Workflow

1. Read ...
2. Run ...
3. Edit ...
4. Verify ...

## Rules

- Preserve ...
- Never ...
- Ask the user when ...

## Examples

...
```

Writing principles:

- Use imperative steps, such as "Read the schema first" or "Run tests after editing"
- Write mandatory constraints as explicit rules
- Define boundaries for high-risk operations, such as deleting files, migrating data, or sending requests
- Document common branches, such as "if no config file exists, search the default paths first"
- Move long reference material out of `SKILL.md`

## Supporting Resources

A skill can include files next to `SKILL.md`:

```text
my-skill/
├── SKILL.md
├── references/
│   └── api.md
├── examples/
│   └── request.json
├── scripts/
│   └── validate.py
└── templates/
    └── report.md
```

Use supporting files for material that would make `SKILL.md` too long or too hard to scan:

- Put long docs, specs, and API notes in `references/`
- Put input and output samples in `examples/`
- Put reusable commands in `scripts/`
- Put document or code skeletons in `templates/`
- Explain in `SKILL.md` when each supporting file is relevant

Example:

```markdown
## Workflow

1. Read `references/schema.md` before changing generated types.
2. Use `templates/migration.sql` when creating a new migration.
3. Run `python scripts/check_migration.py <file>` before reporting completion.
```

## Invocation

DeepOrca CLI supports automatic and manual skill invocation.

### Automatic Invocation

After each user message, DeepOrca checks the available skills' `name` and `description` fields and selects the skills that match the task. Matching skills are loaded into the current session.

Automatic invocation rules:

- A loaded skill is not loaded again in the same session
- A skill with `metadata.allow-implicit-invocation: false` is not loaded automatically
- Matching considers the current `AGENTS.md` instructions
- If no skill matches, no skill is loaded

### Manual Invocation

Type `/` in the input box to open the skills and commands menu, then select a skill. Use `/skills` to list available skills.

Common commands:

| Command | Behavior |
| ------- | -------- |
| `/` | Open the skills and commands menu |
| `/skills` | List available skills |
| `/<skill-name>` | Select the matching skill from the menu |

## Enable and Disable Skills

Use `enabledSkills` in `settings.json` to enable or disable skills by name.

```json
{
  "enabledSkills": {
    "code-review": true,
    "db-migration": false
  }
}
```

Rules:

- Skills not listed are enabled by default
- Setting a skill to `false` hides every scanned skill with that resolved name
- Project settings override user settings per skill

For more details, see [configuration_en.md](configuration_en.md).

## Skills vs. `AGENTS.md` vs. MCP

| Mechanism | Best for | Not best for |
| --------- | -------- | ------------ |
| `AGENTS.md` | Long-lived repository rules, coding style, test commands, collaboration conventions | Reusable complex workflows or cross-project tool instructions |
| Agent Skill | Reusable workflows, domain knowledge, templates, scripts, reference docs | Temporary requirements for a single task |
| MCP | External systems, live data, browser control, databases, GitHub, and other tool calls | Pure text workflow instructions |

Common pattern:

- Put repository rules in `AGENTS.md`
- Put reusable workflows in skills
- Put external actions behind MCP tools

## Example: Project Release Skill

```markdown
---
name: release-check
description: Prepare and verify a project release. Use when the user asks to release, publish, bump version, update changelog, or run pre-release checks.
---

# Release Check

Use this skill to prepare a safe release for this repository.

## Workflow

1. Read `package.json` and the existing changelog.
2. Inspect commits or diffs since the previous release tag.
3. Update version and changelog only when the user explicitly asks.
4. Run the project test and build commands.
5. Report the version, changed files, verification results, and remaining risks.

## Rules

- Do not publish packages unless the user explicitly asks.
- Do not create or push git tags without explicit approval.
- Preserve existing changelog style.
```

## Troubleshooting

### The skill does not appear in `/skills`

Check:

1. The directory is under one of the DeepOrca scan locations
2. The file is named `SKILL.md`
3. `SKILL.md` is inside its own skill directory, such as `.deeporca/skills/my-skill/SKILL.md`
4. `enabledSkills` has not set the skill to `false`
5. A higher-priority skill with the same name is not shadowing it

### Automatic invocation is unreliable

Check:

1. The `description` contains clear use cases and trigger terms
2. The skill is not so broad that the model cannot infer its boundary
3. `metadata.allow-implicit-invocation` is not set to `false`
4. The user request mentions the relevant domain or file type clearly enough

### The skill is too long

Recommendations:

1. Keep the core workflow and rules in `SKILL.md`
2. Move long documentation into `references/`
3. Move repeatable commands into `scripts/`
4. Explain when the agent should read each supporting file

## References

- [Agent Skills Specification](https://agentskills.io/specification)
