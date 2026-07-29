# android-cli

Android development integration through the official `android` command-line tool. Use it to scaffold projects, drive the emulator, inspect UI layouts, capture annotated screenshots, and search the Android documentation — all from bash.

## When to use

- Create a new Android / Kotlin / Jetpack Compose project
- Start, stop, or list Android Virtual Devices (emulators)
- Install an APK and launch an app on an emulator or connected device
- Capture a screenshot of the current screen **with element labels** (`--annotate`) so you can reason about the UI visually
- Dump and read the on-screen view hierarchy / layout
- Search the official Android developer documentation from the terminal
- Describe the connected device / emulator environment

## When NOT to use

- Pure JVM/Kotlin library work with no Android SDK involvement
- Building Gradle projects (use `gradle` / `./gradlew` directly)
- Git, CI, or general shell tasks unrelated to Android

## Prerequisites

1. The `android` CLI must be installed and on `PATH`. Verify with:

   ```bash
   android --version
   ```

2. Android Studio (or the command-line SDK tools) should be installed so the SDK, platform tools, and system images are available.

3. For emulator commands, at least one AVD must exist (create one with `android create`).

## Command reference

| Command | Purpose |
| --- | --- |
| `android --version` | Check the CLI is installed and print version |
| `android create` | Scaffold a new Android project |
| `android run` | Build, install, and launch an app on a device/emulator |
| `android emulator` | Manage AVDs — list, start, stop emulators |
| `android sdk` | Inspect or manage the installed Android SDK |
| `android screen capture` | Take a screenshot of the current screen |
| `android screen capture --annotate` | Screenshot **with UI elements labelled** — gives the agent "vision" |
| `android layout` | Dump the current view hierarchy |
| `android layout --pretty` | Pretty-print the layout tree for easier reading |
| `android docs search <query>` | Search the official Android developer docs |
| `android describe` | Describe the connected device / emulator environment |
| `android skills` | Discover agent skills bundled with the CLI |

> Always run `android <command> --help` to see the exact flags for your installed version; the table above is a quick-reference summary.

## Examples

### 0. Sanity check

```bash
android --version
```

### 1. Create a new project

```bash
android create --name MyApp --package com.example.myapp --template compose
```

This scaffolds a Jetpack Compose app into `./MyApp`. Adjust `--template` for a Views/Java template if needed.

### 2. Run the app

```bash
android run
```

Builds the project in the current directory, installs the APK onto the running emulator (or connected device), and launches the default launcher activity.

### 3. Manage emulators

```bash
# List available AVDs
android emulator --list

# Boot an AVD (by name)
android emulator --start Pixel_7_API_34

# Stop the running emulator
android emulator --stop
```

### 4. Capture an annotated screenshot

```bash
android screen capture --annotate
```

The `--annotate` flag overlays a numeric label on every interactive UI element and returns the annotated image **plus** a legend mapping each label to its element. This is how the agent gets "vision" over the Android UI: instead of guessing what is on screen, you can read the labels and act on precise targets.

Workflow:

```bash
# 1. capture
android screen capture --annotate

# 2. read the returned legend (label → element + bounds)
#    e.g.  [1] "Save" button   bounds=[44,820,1024,920]
#          [2] "Email" field   bounds=[44,500,1024,600]

# 3. decide your next action based on the real labels
```

Without `--annotate`, the command returns a plain PNG with no element information.

### 5. Inspect the layout

```bash
# Raw view hierarchy (machine-friendly)
android layout

# Human-readable, indented tree
android layout --pretty
```

Use `--pretty` when you need to understand the on-screen structure (parents, children, resource IDs, text) before deciding which element to interact with.

### 6. Search the docs

```bash
android docs search "rememberLazyGridState"
android docs search "WorkManager periodic work"
```

Returns the most relevant pages from developer.android.com. Prefer this over a generic web search for first-party API and guide questions.

### 7. Describe the environment

```bash
android describe
```

Prints the connected device/emulator, Android version, density, ABI, and other facts about the current target. Run this once at the start of a device-specific task.

### 8. Discover bundled skills

```bash
android skills
```

Lists agent skills shipped with the CLI (project setup, testing, publishing, etc.). Load the relevant one before doing specialised work.

## Notes

- **`--annotate` is the key to visual reasoning.** A plain screenshot is an opaque bitmap to a text model; the annotated variant converts the screen into labelled, addressable elements. Always prefer `android screen capture --annotate` when you need to understand or act on the current UI.
- **Combine layout + screenshot.** `android layout --pretty` gives you the structural truth (IDs, hierarchy); the annotated screenshot gives you the visual truth (position, label). Together they remove most guesswork.
- **One emulator at a time.** Most commands target the single running emulator. If multiple devices are attached, `android describe` tells you which one is active; use the CLI's device-selection flags to target a specific serial when needed.
- **Docs search first.** For Android-framework API questions, `android docs search` is faster and more authoritative than a generic web search.
- **Long-running emulator.** Starting an emulator can take 20–60 seconds. Start it once and reuse it across commands rather than booting per-step.
