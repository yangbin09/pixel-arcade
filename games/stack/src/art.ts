import { P, bevel, rect, sparkle, strokeRect } from "@arcade/core";

import { BLOCK_H } from "./logic";

/** 一块方块的配色：主体 + 左上高光 + 右下暗面。 */
export interface BlockTone {
  body: string;
  light: string;
  dark: string;
}

/** 塔身四色循环，越堆越像一摞彩色积木。 */
export const BLOCK_TONES: readonly BlockTone[] = [
  { body: P.purple, light: P.lav, dark: P.panel },
  { body: P.grass, light: P.grassHi, dark: P.grassDeep },
  { body: P.amber, light: P.gold, dark: P.orange },
  { body: P.red, light: P.pink, dark: P.redDeep },
];

/** 按层数取配色：0 层是底座，之后四色循环。 */
export function toneForFloor(floor: number): BlockTone {
  const index = Math.max(0, Math.floor(Number.isFinite(floor) ? floor : 0));
  return BLOCK_TONES[index % BLOCK_TONES.length] as BlockTone;
}

/** 静止的方块：主体 + 斜切高光 + 顶面亮线，宽度太窄时省略细节避免糊掉。 */
export function drawBlock(
  ctx: CanvasRenderingContext2D,
  x: number,
  top: number,
  width: number,
  tone: BlockTone,
  height = BLOCK_H,
): void {
  const left = Math.round(x);
  const y = Math.round(top);
  const w = Math.round(width);
  const h = Math.round(height);
  if (w <= 0 || h <= 0) return;

  rect(ctx, left, y + 1, w, h - 1, tone.body);

  if (w >= 8 && h >= 6) {
    bevel(ctx, left, y, w, h, tone.light, tone.dark);
    // 顶面提亮一条，看起来像被上方光源照到。
    rect(ctx, left + 2, y + 2, w - 4, 1, tone.light);
    // 两端的铆钉，宽度够才画。
    if (w >= 20) {
      const dot = Math.max(6, Math.round(w / 2) - 6);
      rect(ctx, left + dot, y + Math.floor(h / 2), 1, 1, tone.dark);
      rect(ctx, left + dot + 12, y + Math.floor(h / 2), 1, 1, tone.dark);
    }
    return;
  }

  rect(ctx, left, y, w, 1, tone.light);
  rect(ctx, left, y + h - 1, w, 1, tone.dark);
}

/**
 * 悬停中的活动块：两侧一列 1px 虚线导引直落塔顶，中间一条块心定位线，
 * 让玩家能看清左右边缘和下方塔顶差多少。
 */
export function drawMovingBlock(
  ctx: CanvasRenderingContext2D,
  x: number,
  top: number,
  width: number,
  tone: BlockTone,
  guideBottom: number,
): void {
  const left = Math.round(x);
  const w = Math.round(width);
  const y = Math.round(top);

  const bottom = Math.round(guideBottom);
  if (bottom > y + BLOCK_H) {
    ctx.globalAlpha = 0.32;
    for (let gy = y + BLOCK_H; gy < bottom; gy += 4) {
      rect(ctx, left, gy, 1, 2, tone.light);
      rect(ctx, left + w - 1, gy, 1, 2, tone.light);
    }
    ctx.globalAlpha = 1;
  }

  drawBlock(ctx, x, top, width, tone);

  if (w >= 6) rect(ctx, left + Math.floor(w / 2), y + 1, 1, BLOCK_H - 1, tone.light);
}

/** 被裁下来的一块碎料：带 1px 高光的下落矩形，越旧越淡。 */
export function drawShard(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  alpha: number,
  color: string,
): void {
  const w = Math.round(width);
  const h = Math.round(height);
  if (w <= 0 || h <= 0) return;
  const a = Math.max(0, Math.min(1, alpha));
  if (a <= 0) return;

  ctx.globalAlpha = a;
  rect(ctx, x, y, w, h, color);
  rect(ctx, x, y, w, 1, P.cream);
  rect(ctx, x, y + h - 1, w, 1, P.void);
  ctx.globalAlpha = 1;
}

/** 完美落点的星芒爆点。 */
export function drawPerfectBurst(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  life: number,
): void {
  const k = Math.max(0, Math.min(1, life));
  if (k <= 0) return;

  const spread = Math.round((1 - k) * 9);
  const cx = Math.round(x);
  const cy = Math.round(y);

  ctx.globalAlpha = k;
  sparkle(ctx, cx, cy, 2 + spread, P.gold, P.white);
  rect(ctx, cx - spread - 3, cy, spread + 3, 1, P.gold);
  rect(ctx, cx + 1, cy, spread + 3, 1, P.gold);
  ctx.globalAlpha = 1;
}

/** 静态背景：夜空、两侧立柱、顶部吊臂横梁。地面随摄像机滚动，另外画。 */
export function paintBackdrop(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  rect(ctx, 0, 0, w, h, P.night);

  // 上方渐暗：两层横带模拟纵深。
  rect(ctx, 0, 0, w, 34, P.void);
  ctx.globalAlpha = 0.5;
  rect(ctx, 0, 0, w, 20, P.void);
  ctx.globalAlpha = 1;

  // 远处静态星点，位置写死保证每帧稳定。
  for (let i = 0; i < 26; i += 1) {
    const x = (i * 41 + 13) % w;
    const y = (i * 29 + 7) % 100;
    rect(ctx, x, y, 1, 1, i % 6 === 0 ? P.lav : P.line);
  }

  // 两侧立柱：让画面有「机台」的边界。
  rect(ctx, 0, 0, 3, h, P.void);
  rect(ctx, w - 3, 0, 3, h, P.void);
  rect(ctx, 3, 0, 1, h, P.line);
  rect(ctx, w - 4, 0, 1, h, P.line);
  for (let y = 12; y < h - 12; y += 26) {
    rect(ctx, 1, y, 1, 6, P.lineHi);
    rect(ctx, w - 2, y, 1, 6, P.lineHi);
  }

  // 顶部吊臂：新块在横梁下方摆动。
  rect(ctx, 3, 14, w - 6, 2, P.line);
  rect(ctx, 3, 14, w - 6, 1, P.lineHi);
  for (let x = 10; x < w - 10; x += 24) rect(ctx, x, 16, 1, 4, P.line);
  rect(ctx, 3, 12, 3, 6, P.panel2);
  rect(ctx, w - 6, 12, 3, 6, P.panel2);
}

/** 地面：世界坐标随摄像机上移，所以这里收的是屏幕纵坐标。 */
export function drawGround(ctx: CanvasRenderingContext2D, screenY: number, w: number, h: number): void {
  const y = Math.round(screenY);
  if (y >= h) return;

  rect(ctx, 0, y, w, h - y, P.void);
  rect(ctx, 0, y, w, 1, P.lineHi);
  ctx.globalAlpha = 0.5;
  const rows = Math.min(3, Math.floor((h - y) / 5));
  for (let row = 0; row < rows; row += 1) {
    for (let x = 6; x < w - 6; x += 10) rect(ctx, x, y + 3 + row * 5, 6, 1, P.line);
  }
  ctx.globalAlpha = 1;
}

/* ---------------- 首页缩略图 ---------------- */

/**
 * 缩略图里的迷你塔：80×50 卡片中央一摞方块，顶上还有一块在摆动，
 * 和游戏画面共用配色表与 drawBlock。
 */
export function drawMiniTower(
  ctx: CanvasRenderingContext2D,
  boxX: number,
  boxY: number,
  boxW: number,
  boxH: number,
  time: number,
): void {
  rect(ctx, boxX, boxY, boxW, boxH, P.night);

  // 地面带：只占底部 6px，剩下的高度全留给塔。
  const groundH = 6;
  const groundY = boxY + boxH - groundH;
  rect(ctx, boxX, groundY, boxW, groundH, P.void);
  rect(ctx, boxX, groundY, boxW, 1, P.lineHi);

  const widths = [38, 32, 26, 22];
  const blockH = 7;
  let baseY = groundY;

  for (let i = 0; i < widths.length; i += 1) {
    const w = widths[i] as number;
    const top = baseY - blockH;
    // 每块左右错开 1px，看起来才像手工堆的。
    const x = boxX + Math.round((boxW - w) / 2) + (i % 2 === 0 ? -1 : 1);
    drawBlock(ctx, x, top, w, toneForFloor(i + 1), blockH);
    baseY = top;
  }

  // 顶上摆动的下一块：6px 高，和塔顶留 3px 缝。
  const nextW = 14;
  const nextH = 6;
  const gap = 3;
  const swing = Math.sin(time * 2.2) * 6;
  const nextTop = baseY - gap - nextH;
  const nextX = boxX + Math.round((boxW - nextW) / 2 + swing);
  drawBlock(ctx, nextX, nextTop, nextW, toneForFloor(widths.length + 1), nextH);

  // 两块之间的导引短线。
  ctx.globalAlpha = 0.3;
  for (let y = baseY - gap; y < baseY; y += 1) {
    rect(ctx, nextX, y, 1, 1, P.cream);
    rect(ctx, nextX + nextW - 1, y, 1, 1, P.cream);
  }
  ctx.globalAlpha = 1;

  // 落点星芒，随呼吸闪。
  if (Math.sin(time * 3.4) > 0.2) {
    sparkle(ctx, boxX + Math.round(boxW / 2), boxY + 4, 1, P.gold, P.white);
  }

  strokeRect(ctx, boxX, boxY, boxW, boxH, P.line);
}


