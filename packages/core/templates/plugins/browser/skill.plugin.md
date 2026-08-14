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
actions:
  - { id: "browser.session-start", description: "启动浏览器会话" }
  - { id: "browser.command", description: "执行浏览器命令（navigate/snapshot/click/fill/evaluate）" }
  - { id: "browser.session-stop", description: "关闭浏览器会话" }
---

# 浏览器行为插件

真实浏览器操控与智能联网能力。

## 包含能力

### 插件

- **browser-skill** — 通过 `bsk` CLI 驱动用户的真实 Chromium 浏览器。携带登录态访问页面、填写表单、抓取数据、点击交互流程、回归测试 UI。

### 技能

- **web-access-strategy** — 智能联网策略。根据任务类型自动选择最佳联网方式（WebSearch / curl / Jina Reader / browser-skill），并按域名积累访问经验。

### Actions（命令式能力）

- **browser.session-start** — 启动浏览器会话，返回 session ID
- **browser.command** — 在活跃会话上执行命令（navigate/snapshot/click/fill/evaluate/scroll）
- **browser.session-stop** — 关闭会话并释放浏览器
