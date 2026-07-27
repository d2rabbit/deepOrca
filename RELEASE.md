# 版本发布

DeepOrca 使用 `scripts/version.js` 管理 monorepo 的版本号：

| 脚本 | 命令 | 用途 |
|------|------|------|
| `scripts/version.js` | `npm run release:version` | 升级所有 workspace 包的版本号 + 重新生成 lockfile |

当前不发布 npm 包；版本号仅用于 git tag 与变更追踪。

---

## release:version — 版本号升级

用法与 `npm version` 一致，支持所有标准 bump 类型。

### 基本用法

```bash
npm run release:version -- <bump-type | version> [options]
```

> 注意：npm scripts 传参需要 `--` 分隔符。

### 支持的 bump 类型

| 类型 | 当前版本 | 结果 | 说明 |
|------|---------|------|------|
| `patch` | `0.1.31` | `0.1.32` | 补丁版本 +1 |
| `minor` | `0.1.31` | `0.2.0` | 次版本 +1，patch 归零 |
| `major` | `0.1.31` | `1.0.0` | 主版本 +1，minor/patch 归零 |
| `prepatch` | `0.1.31` | `0.1.32-0` | 预发布补丁 |
| `preminor` | `0.1.31` | `0.2.0-0` | 预发布次版本 |
| `premajor` | `0.1.31` | `1.0.0-0` | 预发布主版本 |
| `prerelease` | `0.1.31` | `0.1.32-0` | 递增预发布号 |
| `from-git` | — | 从最新 git tag 读取 | 适用于已有 tag 但未更新 package.json 的情况 |

也可以直接指定版本号：

```bash
npm run release:version -- 0.2.0
```

### 预发布链

`prerelease` 支持链式递增：

```
0.1.31
  → prerelease → 0.1.32-beta.0
  → prerelease → 0.1.32-beta.1
  → prerelease → 0.1.32-beta.2
  → patch      → 0.1.32        （去掉 prerelease 后缀）
```

### --preid 选项

预发布标识符，默认为 `"0"`，可自定义：

```bash
npm run release:version -- prerelease --preid beta
# 0.1.31 → 0.1.32-beta.0

npm run release:version -- premajor --preid alpha
# 0.1.31 → 1.0.0-alpha.0
```

### 实际执行的操作

1. 读取 `packages/core/package.json` 中的当前版本
2. 根据 bump 类型计算目标版本
3. 更新 **所有** `packages/*/package.json` 的 `version` 字段（core、cli、vscode-ide-companion）
4. 删除旧的 `package-lock.json`，执行 `npm install --package-lock-only` 重新生成

### 完整示例

```bash
# 升级 patch 版本
npm run release:version -- patch

# 升级 minor 版本
npm run release:version -- minor

# 发布 beta 预发布版
npm run release:version -- prerelease --preid beta

# 直接指定版本
npm run release:version -- 0.2.0

# 从 git tag 获取版本
npm run release:version -- from-git
```

升级后检查变更，确认无误后提交：

```bash
git diff
git add -A
git commit -m "chore(release): v0.1.32"
git tag v0.1.32
```

---
