/**
 * Implementation-brief generator (main tools/prototype-brief.ts) — specs/
 * artifact-landing 链路 C. Pins:
 *   - six fixed sections in zh and en packs (C12/C16),
 *   - anti-collapse wording present in the per-screen layout lines (C13),
 *   - unresolved screen references block the brief with a gap list (C14),
 *   - openui input degrades to a verbatim source appendix (C14),
 *   - no absolute coordinates in the output.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildImplementationBrief } from "../main/tools/prototype-brief";

const SPEC = `# 登录模块重设计

产出可演示的登录界面与验收口径。

## 登录页

- 账号密码输入，支持回车提交
- 登录失败显示错误提示

## 验证码页

滑块验证，失败三次后冷却。

### 待确认

- 验证码冷却时长
- 是否记住账号
`;

test("brief: zh spec → six fixed sections with screens, behaviors and todos", () => {
  const res = buildImplementationBrief({ kind: "spec", specMd: SPEC, title: "登录重设计", locale: "zh" });
  assert.equal(res.ok, true);
  const md = res.briefMd ?? "";
  // Six fixed sections, in order
  const order = ["## 目标", "## 屏幕清单", "## 逐屏布局", "## 行为与导航", "## 技术栈映射", "## 落地守则"].map((h) =>
    md.indexOf(h)
  );
  assert.ok(
    order.every((pos) => pos >= 0),
    "all six sections present"
  );
  assert.deepEqual(
    [...order].sort((a, b) => a - b),
    order,
    "sections appear in fixed order"
  );
  // Screens extracted from ## sections; behaviors from bullets
  assert.ok(md.includes("屏幕「登录页」") || md.includes("「登录页」"), "screen scope present");
  assert.ok(md.includes("账号密码输入，支持回车提交"), "behavior entry carried over");
  assert.ok(md.includes("验证码冷却时长"), "待确认 items verbatim");
  // Anti-collapse wording + no markdown-heading coordinates
  assert.ok(md.includes("不要竖向堆叠或换行"));
});

test("brief: dangling screen reference blocks generation with gap list (C14)", () => {
  const spec = SPEC + "\n[返回首页](#首页)\n";
  const res = buildImplementationBrief({ kind: "spec", specMd: spec, title: "登录重设计", locale: "zh" });
  assert.equal(res.ok, false);
  assert.ok(res.gaps?.includes("首页"));
  assert.equal(res.briefMd, undefined);
});

test("brief: en locale pack; openui source degrades to verbatim appendix", () => {
  const res = buildImplementationBrief({
    kind: "openui",
    openuiSource: `<button>保存订单</button>\n<a href="#settings">设置</a>\n`,
    title: "订单页",
    brief: "订单管理界面。",
    locale: "en",
  });
  assert.equal(res.ok, true);
  const md = res.briefMd ?? "";
  assert.ok(md.includes("Implementation Brief"));
  assert.ok(md.includes("never fake data") || md.includes("real persistence"));
  // unstructured source degrades to the appendix verbatim (C14)
  assert.ok(md.includes("<button>保存订单</button>"));
  // no absolute coordinate pairs in the output (C13)
  assert.ok(!/:\s*\d{2,}\s*,\s*\d{2,}/.test(md));
});

test("brief: empty spec → ok:false", () => {
  const res = buildImplementationBrief({ kind: "spec", specMd: "   ", title: "t", locale: "zh" });
  assert.equal(res.ok, false);
});
