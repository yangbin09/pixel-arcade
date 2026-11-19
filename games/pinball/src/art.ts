import { P, fillCircle, line, rect, strokeRect } from "@arcade/core";

import type { Segment } from "./logic";

/**
 * 弹珠台的像素素材。首页缩略图和游戏画面共用这里的函数，
 * 保证两处是同一套调色板（只取 P.*）。
 */

/** 球：半径 3 的像素圆 + 一点高光，尾巴留给调用方画。 */
export function drawBall(ctx: CanvasRenderingContext2D, cx: number, cy: number, r = 3): void {
  const x = Math.round(cx);
  const y = Math.round(cy);
  fillCircle(ctx, x, y, r, P.cream);
  rect(ctx, x - Math.max(1, r - 2), y - Math.max(1, r - 2), 1, 1, P.white);
  rect(ctx, x + 1, y + 1, 1, 1, P.amber);
}

/** 缓冲器：外圈暗环 + 内圈亮面，hot 越大越亮（命中后衰减）。 */
export function drawBumper(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  radius: number,
  hot = 0,
): void {
  const x = Math.round(cx);
  const y = Math.round(cy);
  const heat = Math.max(0, Math.min(1, hot));

  fillCircle(ctx, x, y, radius, heat > 0.12 ? P.orange : P.panel2);
  fillCircle(ctx, x, y, Math.max(2, radius - 3), heat > 0.12 ? P.gold : P.panel);
  fillCircle(ctx, x, y, Math.max(1, radius - 6), heat > 0.5 ? P.white : heat > 0.12 ? P.amber : P.purple);

  // 外圈的四颗铆钉，让圆看起来像机台零件而不是色块。
  rect(ctx, x - radius, y, 1, 1, P.lineHi);
  rect(ctx, x + radius, y, 1, 1, P.lineHi);
  rect(ctx, x, y - radius, 1, 1, P.lineHi);
  rect(ctx, x, y + radius, 1, 1, P.lineHi);
}

/** 挡板：沿线段画一条 4px 粗的像素带，尖端高光；抬起时换成金色。 */
export function drawFlipper(
  ctx: CanvasRenderingContext2D,
  seg: Segment,
  raised: boolean,
  hot = false,
): void {
  const body = raised ? P.gold : P.lav;
  const shine = raised ? P.white : P.cream;

  line(ctx, seg.x0, seg.y0, seg.x1, seg.y1, P.void, 5);
  line(ctx, seg.x0, seg.y0, seg.x1, seg.y1, body, 4);
  line(
    ctx,
    seg.x0 + (seg.x1 - seg.x0) * 0.18,
    seg.y0 + (seg.y1 - seg.y0) * 0.18,
    seg.x1,
    seg.y1,
    shine,
    1,
  );

  // 根部轴承
  const rx = Math.round(seg.x0);
  const ry = Math.round(seg.y0);
  rect(ctx, rx - 1, ry - 1, 3, 3, P.lineHi);
  rect(ctx, rx, ry, 1, 1, P.void);

  const tipX = Math.round(seg.x1);
  const tipY = Math.round(seg.y1);
  if (hot) rect(ctx, tipX - 1, tipY - 1, 3, 3, P.white);
  else rect(ctx, tipX, tipY, 1, 1, shine);
}

/** 靶标：贴在墙上的 4×10 小灯条，打亮后变金。 */
export function drawTarget(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  lit: boolean,
): void {
  rect(ctx, x, y, w, h, lit ? P.gold : P.panel2);
  if (lit) {
    rect(ctx, x + 1, y + 1, w - 2, 1, P.white);
    rect(ctx, x + 1, y + h - 2, w - 2, 1, P.amber);
  } else {
    rect(ctx, x + 1, y + 2, w - 2, h - 4, P.panel);
  }
}

/** 台面骨架：顶轨、侧墙、铆钉、底部漏球口。 */
export function drawTable(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  // 顶部导轨（发球口在正中）
  rect(ctx, 0, 0, w, 7, P.panel);
  rect(ctx, 0, 7, w, 1, P.line);
  rect(ctx, 0, 0, w, 1, P.lineHi);
  for (let i = 0; i < 5; i += 1) rect(ctx, 14 + i * 34, 3, 3, 2, P.lineHi);

  // 左右侧墙
  rect(ctx, 0, 7, 4, h - 7, P.panel);
  rect(ctx, 4, 7, 1, h - 7, P.line);
  rect(ctx, w - 4, 7, 4, h - 7, P.panel);
  rect(ctx, w - 5, 7, 1, h - 7, P.line);

  // 侧墙铆钉
  for (let i = 0; i < 4; i += 1) {
    rect(ctx, 1, 26 + i * 34, 2, 2, P.lineHi);
    rect(ctx, w - 3, 26 + i * 34, 2, 2, P.lineHi);
  }

  // 底部漏球区（画一条警戒线，提示掉下去就没了）
  rect(ctx, 0, h - 6, w, 1, P.redDeep);
  rect(ctx, 0, h - 5, w, 5, P.void);
  rect(ctx, 0, h - 5, 4, 5, P.panel);
  rect(ctx, w - 4, h - 5, 4, 5, P.panel);
}

/** 发球口的箭头提示。 */
export function drawServeMark(ctx: CanvasRenderingContext2D, x: number, y: number, alpha: number): void {
  ctx.save();
  ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
  rect(ctx, x, y, 1, 4, P.lav);
  rect(ctx, x - 1, y + 2, 3, 1, P.lav);
  rect(ctx, x - 2, y + 3, 5, 1, P.lav);
  ctx.restore();
}
