# TDAI Memory Core — Third-Party Notice

This directory contains source code derived from the TencentDB Agent Memory
project (TDAI Core), licensed under the MIT License.

## Original Source

- **Project**: TencentDB Agent Memory
- **Repository**: https://github.com/TencentCloud/TencentDB-Agent-Memory
- **npm Package**: `@tencentdb-agent-memory/memory-tencentdb`
- **Copyright**: © 2026 Tencent Corporation
- **License**: MIT

## What Was Included

The following components from TDAI Core were incorporated into this package:

- `core/` — L0-L3 memory pipeline (conversation recording, L1 extraction,
  scene splitting, persona generation, store layer, search tools)
- `utils/` — Pipeline infrastructure (factory, manager, checkpoint, timers)
- `config.ts` — Configuration parsing

## What Was Excluded

- `gateway/` — HTTP server (replaced by in-process calls)
- `adapters/openclaw/` — OpenClaw host adapter (not applicable)
- `adapters/standalone/` — Standalone HTTP runner (replaced by DeepOrca adapter)
- `seed/` — Batch seeding CLI tool (not needed at runtime)

## Modifications

The source files have been modified to:
1. Remove OpenClaw-specific dependencies and references
2. Adjust import paths for the new directory structure
3. Integrate with DeepOrca's HostAdapter and LLMRunner interfaces

All modifications are licensed under the same MIT License as the original.
