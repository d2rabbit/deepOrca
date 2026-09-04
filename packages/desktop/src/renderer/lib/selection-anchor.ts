/**
 * 选区数字体浮窗的锚点数学（B-line F1，user ask 2026-09-04）：浮窗追随
 * 选中位置——锚在选区末行，右侧偏下优先；贴右缘左翻、贴下缘上翻，最后
 * clamp 进视口。与索引关系图浮窗（SymbolGraphView/RiskGraphView）的定位
 * 公式族同源，只是锚点从点击坐标换成选区坐标、并支持「提交后冻结」：
 * 冻结时调用方继续传同一锚点（内容坐标随滚动重算），浮窗跟着内容走。
 * 纯函数——便于单测（selection-anchor.test.ts）。
 */

export type AnchorPoint = {
  /** Selection-end position in VIEWPORT coordinates (Monaco
   *  getScrolledVisiblePosition + editor DOM rect). */
  x: number;
  y: number;
  /** Height of the anchor line — flipped placement subtracts it. */
  lineHeight: number;
};

export type FloatPlacement = {
  left: number;
  top: number;
  placement: "right-below" | "left-below" | "right-above" | "left-above";
};

export function computeFloatPlacement(params: {
  anchor: AnchorPoint;
  /** Rendered panel size — used for edge flips and clamping. */
  panelWidth: number;
  panelHeight: number;
  viewportWidth: number;
  viewportHeight: number;
  /** Offset from the anchor + min distance to the viewport edge. */
  gap?: number;
  margin?: number;
}): FloatPlacement {
  const gap = params.gap ?? 14;
  const margin = params.margin ?? 8;
  const { x, y, lineHeight } = params.anchor;
  const flipLeft = x + gap + params.panelWidth > params.viewportWidth - margin;
  const flipAbove = y + lineHeight + gap + params.panelHeight > params.viewportHeight - margin;

  const left = flipLeft ? x - gap - params.panelWidth : x + gap;
  const belowTop = y + lineHeight + 10;
  const aboveTop = y - gap - params.panelHeight;
  const top = flipAbove ? aboveTop : belowTop;

  return {
    left: Math.max(margin, Math.min(left, params.viewportWidth - params.panelWidth - margin)),
    top: Math.max(margin, Math.min(top, params.viewportHeight - params.panelHeight - margin)),
    placement: flipLeft ? (flipAbove ? "left-above" : "left-below") : flipAbove ? "right-above" : "right-below",
  };
}
