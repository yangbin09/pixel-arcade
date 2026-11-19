import { P, bevel, drawPixelText, fillCircle, line, measurePixelText, rect, sparkle, strokeRect } from "@arcade/core";

import { BALL_R, ORIGIN, RIM, type PowerWindow } from "./logic";

/**
 * 像素投篮的全部素材：只用 P 里的颜色和 core 的像素原语。
 *
 * - paintCourt：静态球场（天空、地板、篮板、筐、网），每帧重画，矩形不多
 * - drawBall / drawBallTrail：球与拖影，连中 3 球后球变金
 * - drawPowerMeter：左侧竖力度条，甜区和空心区都标出来
 * - drawArcPreview：蓄力时用同一套抛物线公式画虚线预览
 * - drawPopup：进球 / 不进的飘字
 * - drawMiniHoop：首页缩略图，和实战共用同一套素材
 */

/** 篮板：紧贴筐口右沿竖着的一块。 */
export const BOARD_X = 158;
export const BOARD_W = 8;
export const BOARD_TOP = 50;
export const BOARD_BOTTOM = 104;
/** 网深。 */
export const NET_H = 13;
/** 地板线。 */
export const FLOOR_LINE = 196;

/** 力度条几何：左侧一条竖槽。 */
export const METER_X = 7;
export const METER_Y = 62;
export const METER_W = 9;
export const METER_H = 104;

/**
 * 静态球场：夜空分层 + 地板 + 篮板 + 筐 + 网。
 * 每帧重画，全部是整数像素矩形。
 */
export function paintCourt(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  rect(ctx, 0, 0, w, h, P.night);

  // 夜空：上暗下亮，越靠地板越暖一档。
  rect(ctx, 0, 0, w, 54, P.void);
  ctx.globalAlpha = 0.55;
  rect(ctx, 0, 54, w, 48, P.night);
  ctx.globalAlpha = 0.35;
  rect(ctx, 0, 102, w, 52, P.panel);
  ctx.globalAlpha = 1;

  // 固定星尘：整数公式排布，每次打开构图一致。
  for (let i = 0; i < 30; i += 1) {
    const x = (i * 41 + 11) % w;
    const y = (i * 31 + 7) % 150;
    const tone = i % 6;
    rect(ctx, x, y, 1, 1, tone === 0 ? P.cream : tone < 3 ? P.lav : P.line);
  }

  // 地板：
  rect(ctx, 0, FLOOR_LINE, w, h - FLOOR_LINE, P.dirtDeep);
  rect(ctx, 0, FLOOR_LINE, w, 1, P.dirtHi);
  rect(ctx, 0, FLOOR_LINE + 1, w, 2, P.dirt);
  ctx.globalAlpha = 0.5;
  for (let x = 2; x < w; x += 9) rect(ctx, x, FLOOR_LINE + 4, 4, 1, P.dirt);
  ctx.globalAlpha = 1;

  // 篮板：立柱 + 板面 + 内侧方框。
  rect(ctx, BOARD_X + 3, BOARD_BOTTOM, 2, h - BOARD_BOTTOM - 14, P.line);
  rect(ctx, BOARD_X, BOARD_TOP, BOARD_W, BOARD_BOTTOM - BOARD_TOP, P.panel2);
  strokeRect(ctx, BOARD_X, BOARD_TOP, BOARD_W, BOARD_BOTTOM - BOARD_TOP, P.lineHi);
  rect(ctx, BOARD_X + 1, BOARD_TOP + 1, BOARD_W - 2, 1, P.lav);
  // 板面中央的小方框（投篮瞄准点）。
  strokeRect(ctx, BOARD_X + 2, 78, BOARD_W - 4, 14, P.line);

  // 筐：横杆 + 两端的高光钩子。
  rect(ctx, RIM.x, RIM.y, RIM.w, 2, P.orange);
  rect(ctx, RIM.x, RIM.y, RIM.w, 1, P.amber);
  rect(ctx, RIM.x, RIM.y, 2, 2, P.gold);
  rect(ctx, RIM.x + RIM.w - 2, RIM.y, 2, 2, P.gold);
  // 从筐口到篮板的一小段连接。
  rect(ctx, RIM.x + RIM.w, RIM.y, BOARD_X - (RIM.x + RIM.w), 1, P.orange);

  drawNet(ctx, RIM.x + 2, RIM.y + 2, RIM.w - 4, NET_H);
}

/** 网：竖线逐行收窄，底部加密；每行交替一档色，像素感更强。 */
function drawNet(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
  for (let row = 0; row < h; row += 1) {
    const inset = Math.floor((row * 4) / h);
    const left = x + inset;
    const width = Math.max(2, w - inset * 2);
    const color = row % 3 === 2 ? P.lineHi : P.cream;
    rect(ctx, left, y + row, width, 1, color);
  }
  // 纵向网绳。
  for (let col = 0; col <= 4; col += 1) {
    for (let row = 0; row < h; row += 1) {
      const inset = Math.floor((row * 4) / h);
      const left = x + inset;
      const width = Math.max(2, w - inset * 2);
      const px = left + Math.round((col * (width - 1)) / 4);
      if (row % 2 === 0) rect(ctx, px, y + row, 1, 1, P.lineHi);
    }
  }
}

/** 球：3px 半径的像素圆，带一点高光；hot 时整颗变金。 */
export function drawBall(ctx: CanvasRenderingContext2D, cx: number, cy: number, hot = false): void {
  const x = Math.round(cx);
  const y = Math.round(cy);
  fillCircle(ctx, x, y, BALL_R, hot ? P.gold : P.orange);
  ctx.globalAlpha = 0.85;
  fillCircle(ctx, x, y, BALL_R - 1, hot ? P.amber : P.dirtHi);
  ctx.globalAlpha = 1;
  rect(ctx, x - 1, y - 2, 2, 1, hot ? P.white : P.cream);
  // 球纹：一条贯穿的暗线。
  rect(ctx, x - BALL_R, y, BALL_R * 2 + 1, 1, hot ? P.orange : P.dirtDeep);
}

/** 球的拖影：越旧越淡，1px 方块。 */
export function drawBallTrail(
  ctx: CanvasRenderingContext2D,
  points: readonly { x: number; y: number }[],
  hot = false,
): void {
  const color = hot ? P.gold : P.orange;
  for (let i = 0; i < points.length; i += 1) {
    const p = points[i];
    if (!p) continue;
    ctx.globalAlpha = 0.06 + (0.3 * (i + 1)) / points.length;
    rect(ctx, Math.round(p.x) - 1, Math.round(p.y) - 1, 2, 2, color);
  }
  ctx.globalAlpha = 1;
}

/**
 * 左侧竖力度条：外框 + 从下往上填充的力度 + 甜区 / 空心区两条标记。
 *
 * 甜区（能进）画成金色刻线，空心区画成奶白细线，
 * 玩家读两次就明白「要停在金色那一段」。
 */
export function drawPowerMeter(
  ctx: CanvasRenderingContext2D,
  power: number,
  make: PowerWindow,
  swish: PowerWindow,
  charging: boolean,
): void {
  const x = METER_X;
  const y = METER_Y;
  const w = METER_W;
  const h = METER_H;

  // 槽底与边框。
  rect(ctx, x, y, w, h, P.void);
  strokeRect(ctx, x, y, w, h, charging ? P.lineHi : P.line);
  bevel(ctx, x, y, w, h, P.panel2, P.void);

  // 可进区间（金色）与空心区间（奶白）标在槽内侧。
  const bandTop = (value: number): number => y + h - Math.round(value * h);
  rect(ctx, x + 1, bandTop(make.high), w - 2, Math.max(1, bandTop(make.low) - bandTop(make.high)), P.dirtDeep);
  rect(ctx, x + w - 4, bandTop(make.high), 2, Math.max(1, bandTop(make.low) - bandTop(make.high)), P.gold);
  rect(ctx, x + w - 3, bandTop(swish.high), 1, Math.max(1, bandTop(swish.low) - bandTop(swish.high)), P.white);

  // 填充：从下往上，过热（>=0.9）变红提示「太长」。
  const filled = Math.round(Math.max(0, Math.min(1, power)) * (h - 2));
  if (filled > 0) {
    const color = power >= 0.9 ? P.red : power >= make.low ? P.gold : P.mint;
    rect(ctx, x + 1, y + h - 1 - filled, w - 2, filled, color);
    ctx.globalAlpha = 0.45;
    rect(ctx, x + 1, y + h - 1 - filled, 1, filled, P.white);
    ctx.globalAlpha = 1;
  }

  // 当前力度指针（横向一根亮线）。
  const cursorY = bandTop(power);
  rect(ctx, x - 1, cursorY, w + 2, 1, P.white);
  rect(ctx, x + w + 1, cursorY, 2, 1, P.gold);

  // 条上的小读数：0 / 1 端点刻度。
  rect(ctx, x + w + 1, y, 2, 1, P.lineHi);
  rect(ctx, x + w + 1, y + h - 1, 2, 1, P.lineHi);
}

/**
 * 蓄力时的抛物线虚点预览：和 stepBall 用同一套物理，
 * 所以预览的落点就是真实落点（不额外解释，玩家自己会发现）。
 */
export function drawArcPreview(
  ctx: CanvasRenderingContext2D,
  points: readonly { x: number; y: number }[],
  hot: boolean,
): void {
  const color = hot ? P.gold : P.lav;
  for (let i = 0; i < points.length; i += 1) {
    const p = points[i];
    if (!p) continue;
    const radius = i % 4 === 0 ? 1 : 0;
    ctx.globalAlpha = 0.18 + (0.5 * i) / Math.max(1, points.length);
    if (radius) fillCircle(ctx, Math.round(p.x), Math.round(p.y), 1, color);
    else rect(ctx, Math.round(p.x), Math.round(p.y), 1, 1, color);
  }
  ctx.globalAlpha = 1;
}

/** 进球 / 不进 的飘字：带硬阴影，向上飘并渐隐。 */
export function drawPopup(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  life: number,
  color: string,
  size = 2,
): void {
  const alpha = Math.max(0, Math.min(1, life));
  if (alpha <= 0) return;
  const width = measurePixelText(text, size);
  const px = Math.round(x - width / 2);
  const py = Math.round(y - (1 - life) * 14);
  ctx.globalAlpha = alpha;
  drawPixelText(ctx, text, px, py, size, color, P.void);
  ctx.globalAlpha = 1;
}

/** 筐口的命中闪光：进球瞬间筐沿亮一圈。 */
export function drawRimFlash(ctx: CanvasRenderingContext2D, life: number, color: string): void {
  const alpha = Math.max(0, Math.min(1, life));
  if (alpha <= 0) return;
  const spread = Math.round((1 - alpha) * 4);
  ctx.globalAlpha = alpha;
  rect(ctx, RIM.x - 1 - spread, RIM.y - 1, RIM.w + 2 + spread * 2, 1, color);
  rect(ctx, RIM.x - 1, RIM.y - 1 - spread, 1, 1, color);
  rect(ctx, RIM.x + RIM.w, RIM.y - 1 - spread, 1, 1, color);
  ctx.globalAlpha = 1;
}

/** 出手点的球架：地面上一小块底座，让球的出发点有依托。 */
export function drawRack(ctx: CanvasRenderingContext2D, time: number): void {
  const x = ORIGIN.x - 6;
  const y = FLOOR_LINE - 4;
  rect(ctx, x, y, 13, 4, P.dirtDeep);
  rect(ctx, x, y, 13, 1, P.dirtHi);
  rect(ctx, x + 1, y - 2, 2, 2, P.line);
  rect(ctx, x + 10, y - 2, 2, 2, P.line);
  const pulse = Math.round((Math.sin(time * 0.004) + 1) * 1);
  rect(ctx, ORIGIN.x - 1, y - 4 - pulse, 2, 1, P.mint);
}

/* ---------------- 首页缩略图 ---------------- */

/** 缩略图里的迷你球架：篮板 + 筐 + 网，和实战共用配色。 */
export function drawMiniHoop(ctx: CanvasRenderingContext2D, boxX: number, boxY: number, alpha = 1): void {
  ctx.globalAlpha = alpha;
  // 篮板
  rect(ctx, boxX + 20, boxY - 8, 6, 20, P.panel2);
  strokeRect(ctx, boxX + 20, boxY - 8, 6, 20, P.lineHi);
  // 筐
  rect(ctx, boxX + 2, boxY, 19, 2, P.orange);
  rect(ctx, boxX + 2, boxY, 19, 1, P.amber);
  rect(ctx, boxX + 2, boxY, 1, 2, P.gold);
  rect(ctx, boxX + 20, boxY, 1, 2, P.gold);
  // 网
  for (let row = 0; row < 6; row += 1) {
    const inset = Math.floor((row * 2) / 6);
    rect(ctx, boxX + 3 + inset, boxY + 2 + row, 17 - inset * 2, 1, row % 2 === 0 ? P.cream : P.lineHi);
  }
  ctx.globalAlpha = 1;
}

/** 缩略图里的迷你球：2px 半径。 */
export function drawMiniBall(ctx: CanvasRenderingContext2D, x: number, y: number, hot: boolean): void {
  fillCircle(ctx, Math.round(x), Math.round(y), 2, hot ? P.gold : P.orange);
  rect(ctx, Math.round(x) - 1, Math.round(y) - 1, 1, 1, P.cream);
}

/** 缩略图的装饰星芒。 */
export function drawMiniSparkle(ctx: CanvasRenderingContext2D, x: number, y: number, big: boolean): void {
  sparkle(ctx, x, y, big ? 2 : 1, P.gold, P.white);
}

/** 迷你虚线弧：缩略图里球飞行的轨迹。 */
export function drawMiniArc(
  ctx: CanvasRenderingContext2D,
  points: readonly { x: number; y: number }[],
  color: string,
): void {
  for (const p of points) rect(ctx, Math.round(p.x), Math.round(p.y), 1, 1, color);
  if (points.length > 1) {
    const last = points[points.length - 1];
    const prev = points[points.length - 2];
    if (last && prev) line(ctx, prev.x, prev.y, last.x, last.y, color);
  }
}
