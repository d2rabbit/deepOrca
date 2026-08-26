# TDAI Core — Upstream Notice

This directory is a complete, self-contained fork of **TencentDB Agent Memory
(TDAI Core)** — <https://github.com/TencentCloud/TencentDB-Agent-Memory>.

Upstream license: **MIT** (this fork keeps it; the DeepOrca project-wide
MPL-2.0 does **not** apply to files in this directory). The upstream notice is
preserved verbatim below, as fetched from the repository above:

```
Tencent is pleased to support the open source community by making TencentDB Agent Memory available.

Copyright (C) 2026 Tencent.  All rights reserved.

TencentDB Agent Memory is licensed under the MIT.

Terms of the MIT:
--------------------------------------------------------------------
Permission is hereby granted, free of charge, to any person obtaining
a copy of this software and associated documentation files (the
"Software"), to deal in the Software without restriction, including
without limitation the rights to use, copy, modify, merge, publish,
distribute, sublicense, and/or sell copies of the Software, and to
permit persons to whom the Software is furnished to do so, subject to
the following conditions:

The above copyright notice and this permission notice shall be
included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT,
TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```

Local modifications relative to upstream are documented in the DeepOrca
repository history for this path.

## Fork baseline & sync policy (2026-08-21)

- **Baseline commit**: upstream `0aff21a` (**v2.0.0**, 2026-08-03), imported
  2026-08-05. Upstream's active branch is `feat/server_team`; `main` receives
  documentation-only updates.
- **Sync policy**: hard fork, selective porting only. Upstream has pivoted to
  multi-tenant team services (Hub / Proxy / SDK v3); wholesale re-sync is not
  viable. Review upstream releases quarterly and port core-pipeline fixes
  only. Deliberately NOT adopted from v2.0.1-beta.1: `core/memory-prompt/`
  (multi-tenant prompt strategies), `utils/checkpoint.ts` distributed locks
  (single-process here), `store/sqlite.ts`/`tcvdb.ts` additions backing those
  subsystems.
- **`core/skill/` (conversation→SOP skill extraction) was not included at
  fork time** — the original exclusion list omitted it and no decision record
  exists. Decision 2026-08-21: do **not** port it; the capability will be
  built natively against DeepOrca's own skills system instead (constraints in
  `specs/memory-remediation/design.md` §五).
