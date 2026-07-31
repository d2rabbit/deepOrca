// Vendor Apple Xcode 27 Agent Skills + twostraws/swift-agent-skills.
// Apple skills: exported via `xcrun agent skills export` (macOS only, requires Xcode 27).
// twostraws: curated link directory (no SKILL.md files in-repo, links out).
// Since Apple skills require Xcode CLI on macOS, we create a SKILL.md that documents
// the export process. The actual skill content is produced at runtime by xcrun.
//
// On non-macOS platforms, this script is a no-op (xcrun doesn't exist).
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const bundledDir = join(root, "packages", "core", "templates", "skills", "bundled");

function main() {
  if (process.platform !== "darwin") {
    console.log("\n📦 Apple skills: not macOS — skipping (xcrun required).\n");
    return;
  }
  console.log("\n📦 Installing Apple Xcode 27 Agent Skills...\n");

  // Create a meta-skill that teaches the agent how to use Apple's exported skills.
  const skillDir = join(bundledDir, "apple-xcode-skills");
  mkdirSync(skillDir, { recursive: true });

  writeFileSync(
    join(skillDir, "SKILL.md"),
    `---
name: apple-xcode-skills
description: >-
  Apple platform development (macOS + iOS). Guides for SwiftUI modern APIs,
  UIKit modernization, test modernization, security audit, C bounds safety,
  and device interaction. Requires Xcode 27 on macOS. Use when developing
  Swift/SwiftUI/UIKit apps or working with Apple frameworks.
---

# Apple Xcode 27 Agent Skills

Apple ships 7 first-party Agent Skills with Xcode 27. To use them:

## Prerequisites
- macOS with Xcode 27 installed
- Run: \`xcrun agent skills export ~/.agents/skills\`

## Available Skills (after export)
1. **uikit-app-modernization** — Modernize UIKit code to current best practices
2. **device-interaction** — Interact with iOS/macOS devices and simulators
3. **swiftui-whats-new-27** — What's new in SwiftUI for 2025
4. **swiftui-specialist** — Expert SwiftUI patterns and modern API usage
5. **test-modernizer** — Modernize testing approach (Swift Testing)
6. **c-bounds-safety** — C interop bounds safety analysis
7. **audit-xcode-security-settings** — Audit Xcode project security settings

## Community Skills
Paul Hudson (hackingwithswift.com) maintains a curated directory at
https://github.com/twostraws/swift-agent-skills with ~31 additional skills
covering SwiftData, Swift Concurrency, Swift Testing, Accessibility, and more.

## When to Use
- SwiftUI/UIKit app development
- Apple framework integration (SwiftData, Core Data, App Intents)
- iOS/macOS testing modernization
- C interop safety analysis
- Xcode security auditing
`
  );

  console.log("  ✅ Installed apple-xcode-skills meta-skill.");
}

try {
  main();
} catch (e) {
  console.error("[install-apple-skills]", e.message);
  process.exit(0);
}
