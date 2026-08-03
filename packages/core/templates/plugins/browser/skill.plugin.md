---
name: browser
description: "浏览器行为插件 — 真实 Chrome 操控与智能联网策略"
category: automation
icon: browser
plugins:
  - browser-skill
skills:
  - name: web-access-strategy
    description: "智能联网策略 — 自动选择 WebSearch/curl/Jina/bsk 并按域名积累经验"
---

# 浏览器行为插件

真实浏览器操控与智能联网能力。

## 包含能力

### 插件

- **browser-skill** — 通过 `bsk` CLI 驱动用户的真实 Chromium 浏览器。携带登录态访问页面、填写表单、抓取数据、点击交互流程、回归测试 UI。

### 技能

- **web-access-strategy** — 智能联网策略。根据任务类型自动选择最佳联网方式（WebSearch / curl / Jina Reader / browser-skill），并按域名积累访问经验。
