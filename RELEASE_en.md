# Release

DeepOrca uses `scripts/version.js` to manage versions in the monorepo:

| Script | Command | Purpose |
|--------|---------|---------|
| `scripts/version.js` | `npm run release:version` | Bump all workspace package versions + regenerate lockfile |

No npm packages are published currently; versions are used for git tags and change tracking only.

---

## release:version — Version Bump

Works like `npm version`, supporting all standard bump types.

### Basic Usage

```bash
npm run release:version -- <bump-type | version> [options]
```

> Note: npm scripts require the `--` separator to pass arguments.

### Supported Bump Types

| Type | Current | Result | Description |
|------|---------|--------|-------------|
| `patch` | `0.1.31` | `0.1.32` | Patch version +1 |
| `minor` | `0.1.31` | `0.2.0` | Minor version +1, patch reset |
| `major` | `0.1.31` | `1.0.0` | Major version +1, minor/patch reset |
| `prepatch` | `0.1.31` | `0.1.32-0` | Pre-release patch |
| `preminor` | `0.1.31` | `0.2.0-0` | Pre-release minor |
| `premajor` | `0.1.31` | `1.0.0-0` | Pre-release major |
| `prerelease` | `0.1.31` | `0.1.32-0` | Increment pre-release number |
| `from-git` | — | Read from latest git tag | For cases where tag exists but package.json not updated |

You can also specify an exact version:

```bash
npm run release:version -- 0.2.0
```

### Pre-release Chain

`prerelease` supports chained increments:

```
0.1.31
  → prerelease → 0.1.32-beta.0
  → prerelease → 0.1.32-beta.1
  → prerelease → 0.1.32-beta.2
  → patch      → 0.1.32        (drops prerelease suffix)
```

### --preid Option

Pre-release identifier, defaults to `"0"`, customizable:

```bash
npm run release:version -- prerelease --preid beta
# 0.1.31 → 0.1.32-beta.0

npm run release:version -- premajor --preid alpha
# 0.1.31 → 1.0.0-alpha.0
```

### What It Does

1. Reads current version from `packages/core/package.json`
2. Calculates target version based on bump type
3. Updates `version` field in **all** `packages/*/package.json` (core, cli, vscode-ide-companion)
4. Deletes old `package-lock.json` and regenerates via `npm install --package-lock-only`

### Examples

```bash
# Bump patch
npm run release:version -- patch

# Bump minor
npm run release:version -- minor

# Beta pre-release
npm run release:version -- prerelease --preid beta

# Exact version
npm run release:version -- 0.2.0

# From git tag
npm run release:version -- from-git
```

After bumping, review changes and commit:

```bash
git diff
git add -A
git commit -m "chore(release): v0.1.32"
git tag v0.1.32
```

---
