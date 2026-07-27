# AGENTS.md

`AGENTS.md` is a project instruction file for AI coding assistants. Use it to record long-lived repository rules so DeepOrca knows how to install dependencies, run tests, edit code, prepare changes, and follow team conventions.

If you often repeat instructions such as "run this test first", "do not edit that directory", or "include these details in the PR summary", put them in `AGENTS.md`.

## What to Include

Use `AGENTS.md` for stable project rules:

- Project structure and important directories
- Install, development, build, and test commands
- Coding style, naming conventions, and formatting rules
- Testing expectations and verification steps
- Commit, pull request, and release conventions
- Security, configuration, and credential handling notes
- AI collaboration rules that apply only to this repository

Do not use `AGENTS.md` for:

- One-off task requirements, such as "only edit the login page this time"
- Complex reusable workflows, which are better as Agent Skills
- External service connections, which are better configured with MCP
- API keys, passwords, tokens, or other secrets

## Create the File

Run this inside a project:

```text
/init
```

DeepOrca helps create or update `AGENTS.md`. You can also create it manually:

```bash
touch AGENTS.md
```

If you want DeepOrca-specific project instructions, you can use:

```bash
mkdir -p .deeporca
touch .deeporca/AGENTS.md
```

Common choices:

| File | Best for |
| ---- | -------- |
| `AGENTS.md` | Rules that should be visible to multiple AI coding tools |
| `.deeporca/AGENTS.md` | Rules intended only for DeepOrca |
| `~/.deeporca/AGENTS.md` | Personal defaults for repositories without project instructions |

## Recommended Structure

Keep it short, clear, and actionable. Start with sections like these:

```markdown
# Repository Guidelines

## Project Structure

Describe the main directories and where new code should go.

## Development Commands

- `npm install` — Install dependencies.
- `npm test` — Run the test suite.
- `npm run build` — Build the project.

## Coding Style

Describe formatting, naming, and framework conventions.

## Testing

Explain when to add tests and which commands to run.

## Pull Requests

Describe commit style, PR checklist, screenshots, or release notes.

## Agent Notes

List rules for AI assistants, such as files to avoid or checks to run before finishing.
```

You do not need every section. Keep only what helps in this repository.

## Writing Principles

### Write Concrete Commands

Good:

```markdown
## Development Commands

- `npm install` — Install dependencies.
- `npm test` — Run all tests.
- `npm run build` — Type-check and build the CLI.
```

Avoid:

```markdown
Run the usual commands before finishing.
```

### Write Explicit Rules

Good:

```markdown
## Testing

Add or update tests when changing behavior. Before reporting completion, run
`npm test` for test-only changes and `npm run build` for code changes.
```

Avoid:

```markdown
Make sure everything works.
```

### Write Repository Facts

Good:

```markdown
## Project Structure

- `src/` contains application code.
- `tests/` contains automated tests.
- `docs/` contains user-facing documentation.
```

Avoid:

```markdown
This is a normal TypeScript project.
```

### Write Safety Boundaries

Good:

```markdown
## Security

Do not commit API keys or tokens. Use `~/.deeporca/settings.json` for local
credentials and keep project examples redacted.
```

Avoid:

```markdown
Be careful with secrets.
```

## Example

Here is a complete `AGENTS.md` example:

```markdown
# Repository Guidelines

## Project Structure

- `src/` contains application code.
- `src/tests/` contains automated tests.
- `docs/` contains user-facing documentation.
- `config/` contains project configuration examples.

## Development Commands

- `npm install` — Install dependencies.
- `npm test` — Run automated tests.
- `npm run build` — Run checks and build the CLI.

## Coding Style

Use TypeScript. Keep code readable, prefer clear names, and follow the existing
formatting style. Do not introduce unrelated refactors.

## Testing

Add tests when changing behavior. Run the narrowest relevant test first, then
run `npm test` or `npm run build` before reporting completion when practical.

## Agent Notes

- Do not commit secrets or generated local files.
- Preserve existing user changes.
- Explain any verification step that could not be run.
```

## AGENTS.md vs. Skills vs. MCP

| Mechanism | Best for |
| --------- | -------- |
| `AGENTS.md` | Long-lived repository rules, commands, style, and verification steps |
| Agent Skill | Reusable workflows, domain knowledge, templates, scripts, and reference docs |
| MCP | External tools and live data, such as GitHub, browsers, or databases |

Common pattern:

- Put "how this project works" in `AGENTS.md`
- Put "how this type of task works" in an Agent Skill
- Use MCP for work that requires external services

## Maintenance Tips

- Update commands when the project changes
- Remove outdated rules
- Keep it concise; prioritize frequent, important, and easy-to-miss conventions
- Do not include secrets
- If a rule applies only to the current task, write it in the current conversation instead
