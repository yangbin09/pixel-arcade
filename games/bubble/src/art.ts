import { P, fillCircle, line, rect, strokeRect } from "@arcade/core";

import { CANNON_Y, FIELD_W, RADIUS } from "./logic";

/**
 * 4 色泡泡。下标和 logic 里的颜色下标一一对应，缩略图与游戏画面共用这张表，
 * 保证首页卡片和实际画面是同一套色（颜色只从 P.* 取）。
 */
export const BUBBLE_COLORS: readonly string[] = [P.mint, P.gold, P.pink, P.lav];

/** 每色的暗边 / 高光，比本体深一档、亮一档，靠调色板里现成的颜色配对。 */
const BUBBLE_SHADE: readonly string[] = [P.grassDeep, P.orange, P.redDeep, P.purple];
const BUBBLE_LIGHT: readonly string[] = [P.cream, P.cream, P.cream, P.white];

/** 按颜色下标取本体色；越界时回落到第一色（0 是合法下标，不能用真假判断）。 */
export function bubbleColor(index: number): string {
  const slot = Math.floor(Math.abs(Number.isFinite(index) ? index : 0)) % BUBBLE_COLORS.length;
  return BUBBLE_COLORS[slot] as string;
}

export function bubbleShade(index: number): string {
  const slot = Math.floor(Math.abs(Number.isFinite(index) ? index : 0)) % BUBBLE_SHADE.length;
  return BUBBLE_SHADE[slot] as string;
}

export function bubbleLight(index: number): string {
  const slot = Math.floor(Math.abs(Number.isFinite(index) ? index : 0)) % BUBBLE_LIGHT.length;
  return BUBBLE_LIGHT[slot] as string;
}

/**
 * 一颗泡泡：深色外圈 + 本体 + 左上 2×2 高光。
 * 完全由整数像素横条拼成，缩到 3px 半径的缩略图里也不会糊。
 */
export function drawBubble(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  radius: number,
  colorIndex: number,
  options: { dim?: boolean } = {},
): void {
  const r = Math.max(2, Math.round(radius));
  const x = Math.round(cx);
  const y = Math.round(cy);

  ctx.save();
  if (options.dim) ctx.globalAlpha = 0.45;

  fillCircle(ctx, x, y, r, bubbleShade(colorIndex));
  if (r > 3) fillCircle(ctx, x, y, r - 1, bubbleColor(colorIndex));
  else {
    // 半径太小时不留内圈，不然整颗都会变成暗边。
    fillCircle(ctx, x, y, r, bubbleColor(colorIndex));
  }

  if (r >= 4) {
    const dot = r >= 6 ? 2 : 1;
    rect(ctx, x - r + 2, y - r + 2, dot, dot, bubbleLight(colorIndex));
    if (r >= 7) rect(ctx, x - r + 3, y - r + 1, 1, 1, bubbleLight(colorIndex));
  }

  ctx.restore();
}

/** 正在飞行的那颗：多一圈金色描边，和落定的泡泡区分开。 */
export function drawFlyingBubble(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  colorIndex: number,
): void {
  drawBubble(ctx, cx, cy, RADIUS, colorIndex);
  const x = Math.round(cx);
  const y = Math.round(cy);
  rect(ctx, x - 1, y - RADIUS - 1, 3, 1, P.gold);
  rect(ctx, x - 1, y + RADIUS, 3, 1, P.gold);
}

/**
 * 底部炮台：底座 + 炮管 + 待在管口的那颗泡泡。
 * 画布内不重复画触屏按钮，手柄由壳层负责（ctx.padVisible() 由 index.ts 判断）。
 */
export function drawCannon(
  ctx: CanvasRenderingContext2D,
  x: number,
  colorIndex: number,
  loaded = true,
): void {
  const cx = Math.round(x);
  const baseY = CANNON_Y + 10;

  // 炮管：竖直朝上，两像素宽，两侧有高光/暗边。
  rect(ctx, cx - 3, CANNON_Y + 1, 6, 10, P.panel2);
  rect(ctx, cx - 3, CANNON_Y + 1, 1, 10, P.lineHi);
  rect(ctx, cx + 2, CANNON_Y + 1, 1, 10, P.void);

  // 底座：一个梯形，用两条横条凑出斜边。
  rect(ctx, cx - 8, baseY, 16, 3, P.panel);
  rect(ctx, cx - 6, baseY - 2, 12, 2, P.panel2);
  rect(ctx, cx - 8, baseY, 16, 1, P.lineHi);

  // 左右两侧的小支脚，暗示「可左右移动」。
  rect(ctx, cx - 10, baseY + 2, 3, 1, P.line);
  rect(ctx, cx + 7, baseY + 2, 3, 1, P.line);

  if (loaded) {
    drawBubble(ctx, cx, CANNON_Y - RADIUS + 1, RADIUS, colorIndex);
  }
}

/**
 * 缩略图用的迷你炮台：只有底座和管口那颗小泡泡。
 * 缩略图是 80×50，塞不下 `drawCannon` 的原尺寸，所以单独拆一个尺寸可调的版本。
 */
export function drawMiniCannon(
  ctx: CanvasRenderingContext2D,
  cx: number,
  plateY: number,
  radius: number,
  colorIndex: number,
): void {
  const x = Math.round(cx);
  const y = Math.round(plateY);

  rect(ctx, x - radius - 3, y, radius * 2 + 6, 2, P.panel2);
  rect(ctx, x - radius - 3, y, radius * 2 + 6, 1, P.lineHi);
  rect(ctx, x - radius - 1, y - 2, radius * 2 + 2, 2, P.panel);

  drawBubble(ctx, x, y - radius - 2, radius, colorIndex);
}

/** 天花板下方的虚线：泡泡压到这条线以下就输了。 */
export function drawDangerLine(
  ctx: CanvasRenderingContext2D,
  y: number,
  color: string,
  phase = 0,
): void {
  const round = Math.round(y);
  for (let x = Math.round(phase) % 4; x < FIELD_W; x += 4) {
    rect(ctx, x, round, 2, 1, color);
  }
}

/** 顶部的两根短吊杆，把蜂窝「挂」在画布顶上。 */
export function drawCeiling(ctx: CanvasRenderingContext2D, topY: number): void {
  const y = Math.round(topY);
  rect(ctx, 0, y - 3, FIELD_W, 1, P.line);
  for (let i = 0; i < 5; i += 1) {
    rect(ctx, 16 + i * 34, y - 6, 3, 3, P.lineHi);
  }
}

/** 出界 / 掉落的泡泡用的小残影方块。 */
export function drawBubbleBit(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  colorIndex: number,
): void {
  rect(ctx, Math.round(x), Math.round(y), Math.max(1, Math.round(size)), Math.max(1, Math.round(size)), bubbleColor(colorIndex));
}

/** 简易瞄准虚线（只有一点点，用来提示「竖直向上」）。 */
export function drawAimGuide(
  ctx: CanvasRenderingContext2D,
  x: number,
  fromY: number,
  toY: number,
  color: string,
): void {
  line(ctx, x, fromY, x, toY, color, 1);
}

/** 缩略图外框：首页卡片统一的暗底 + 上下细线。 */
export function drawThumbFrame(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  rect(ctx, 0, 0, w, h, P.night);
  rect(ctx, 0, 0, w, 1, P.line);
  rect(ctx, 0, h - 1, w, 1, P.line);
  strokeRect(ctx, 0, 0, w, h, P.line);
}
