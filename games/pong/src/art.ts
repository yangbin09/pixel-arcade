import { P, bevel, drawPixelText, measurePixelText, rect, strokeRect } from "@arcade/core";

import {
  BALL_R,
  BOTTOM_LINE,
  FIELD,
  PADDLE_H,
  PADDLE_T,
  TOP_LINE,
  WALL_L,
  WALL_R,
  type Rect,
} from "./logic";

/** 挡板配色：玩家薄荷、AI 珊瑚红，和 HUD 的 tone 一一对应。 */
export interface PaddleTone {
  body: string;
  light: string;
  dark: string;
}

export const PLAYER_TONE: PaddleTone = { body: P.mint, light: P.cream, dark: P.grassDeep };
export const AI_TONE: PaddleTone = { body: P.red, light: P.pink, dark: P.redDeep };

/** 4×4 像素球。热球（rally 高）时中心换成金色。 */
export function drawBall(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  hot = false,
): void {
  const x = Math.round(cx) - BALL_R;
  const y = Math.round(cy) - BALL_R;
  rect(ctx, x, y, BALL_R * 2, BALL_R * 2, hot ? P.gold : P.cream);
  rect(ctx, x + 1, y + 1, BALL_R, BALL_R, P.white);
}

/** 球的拖影：越旧越淡，只画 1px 方块，避免糊成一片。 */
export function drawTrail(
  ctx: CanvasRenderingContext2D,
  points: readonly { x: number; y: number }[],
  color = P.lav,
): void {
  for (let i = 0; i < points.length; i += 1) {
    const point = points[i];
    if (!point) continue;
    const alpha = 0.08 + (0.34 * (i + 1)) / points.length;
    ctx.globalAlpha = alpha;
    rect(ctx, Math.round(point.x) - 1, Math.round(point.y) - 1, 2, 2, color);
  }
  ctx.globalAlpha = 1;
}

/** 28×4 的挡板，带 1px 斜切高光和端帽。 */
export function drawPaddle(
  ctx: CanvasRenderingContext2D,
  centerX: number,
  planeY: number,
  tone: PaddleTone = PLAYER_TONE,
): void {
  const x = Math.round(centerX - PADDLE_H / 2);
  const y = Math.round(planeY);
  rect(ctx, x, y, PADDLE_H, PADDLE_T, tone.body);
  bevel(ctx, x, y, PADDLE_H, PADDLE_T, tone.light, tone.dark);
  // 两端各一颗小铆钉，让 4px 的厚度也有细节。
  rect(ctx, x + 1, y + 1, 1, 1, P.white);
  rect(ctx, x + PADDLE_H - 2, y + 1, 1, 1, P.white);
}

/** 挡板命中特效：沿挡板平面散开的小火花。 */
export function drawPaddleSpark(
  ctx: CanvasRenderingContext2D,
  centerX: number,
  planeY: number,
  life: number,
  tone: PaddleTone = PLAYER_TONE,
): void {
  const spread = Math.round((1 - life) * 14);
  const y = Math.round(planeY);
  ctx.globalAlpha = Math.max(0, Math.min(1, life));
  rect(ctx, Math.round(centerX) - spread - 2, y, 3 + spread, 1, tone.light);
  rect(ctx, Math.round(centerX) + spread, y, 3, 1, tone.light);
  rect(ctx, Math.round(centerX) - 1, y - 1, 2, 1, P.white);
  ctx.globalAlpha = 1;
}

/** 得分闪光：球门线被击穿时整条亮一下。 */
export function drawGoalFlash(
  ctx: CanvasRenderingContext2D,
  side: "top" | "bottom",
  life: number,
  color = P.red,
): void {
  const alpha = Math.max(0, Math.min(1, life));
  if (alpha <= 0) return;
  const y = side === "top" ? TOP_LINE - 3 : BOTTOM_LINE;
  ctx.globalAlpha = alpha;
  rect(ctx, WALL_L, y, WALL_R - WALL_L, 3, color);
  ctx.globalAlpha = alpha * 0.5;
  rect(ctx, WALL_L, side === "top" ? y + 3 : y - 3, WALL_R - WALL_L, 3, color);
  ctx.globalAlpha = 1;
}

/** 横贯球场的中线（虚线）+ 中圈，竖向对峙感。 */
export function drawCenterLine(ctx: CanvasRenderingContext2D): void {
  const midY = Math.round(FIELD / 2);
  for (let x = WALL_L + 2; x < WALL_R - 2; x += 6) {
    rect(ctx, x, midY, 3, 1, P.line);
  }
  rect(ctx, FIELD / 2 - 8, midY - 8, 17, 1, P.line);
  rect(ctx, FIELD / 2 - 8, midY + 8, 17, 1, P.line);
  rect(ctx, FIELD / 2 - 8, midY - 8, 1, 17, P.line);
  rect(ctx, FIELD / 2 + 8, midY - 8, 1, 17, P.line);
  rect(ctx, FIELD / 2 - 1, midY - 1, 2, 2, P.lineHi);
}

/**
 * 球场底图：夜色地面、左右侧墙、上下球门带和四角铆钉。
 * 每帧重画（168×168 只有少量矩形，不需要离屏缓存）。
 */
export function drawCourt(ctx: CanvasRenderingContext2D): void {
  rect(ctx, 0, 0, FIELD, FIELD, P.night);

  // 上下球门带：比场内暗一档，球越线时由 drawGoalFlash 点亮。
  rect(ctx, 0, 0, FIELD, TOP_LINE, P.void);
  rect(ctx, 0, BOTTOM_LINE, FIELD, FIELD - BOTTOM_LINE, P.void);

  // 球门线上的细装饰。
  for (let x = WALL_L; x < WALL_R; x += 5) {
    rect(ctx, x, TOP_LINE - 1, 2, 1, P.line);
    rect(ctx, x, BOTTOM_LINE, 2, 1, P.line);
  }

  // 左右侧墙。
  rect(ctx, WALL_L - 1, 0, 1, FIELD, P.line);
  rect(ctx, WALL_R, 0, 1, FIELD, P.line);
  for (let y = 4; y < FIELD - 4; y += 12) {
    rect(ctx, WALL_L - 1, y, 1, 4, P.lineHi);
    rect(ctx, WALL_R, y, 1, 4, P.lineHi);
  }

  drawCenterLine(ctx);

  // 四角铆钉，收住画面。
  rect(ctx, 1, 1, 2, 2, P.lineHi);
  rect(ctx, FIELD - 3, 1, 2, 2, P.lineHi);
  rect(ctx, 1, FIELD - 3, 2, 2, P.lineHi);
  rect(ctx, FIELD - 3, FIELD - 3, 2, 2, P.lineHi);
}

/** 比分牌：发球 / 得分瞬间在球场中央显示的 2 位比分。 */
export function drawScoreBoard(
  ctx: CanvasRenderingContext2D,
  player: number,
  ai: number,
  alpha = 1,
): void {
  ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
  const boxW = 58;
  const boxH = 26;
  const x = Math.round((FIELD - boxW) / 2);
  const y = Math.round(FIELD / 2 - boxH / 2);

  rect(ctx, x + 2, y + 2, boxW, boxH, P.void);
  rect(ctx, x, y, boxW, boxH, P.panel);
  strokeRect(ctx, x, y, boxW, boxH, P.lineHi);
  rect(ctx, x + 2, y + 2, boxW - 4, 1, P.lineHi);

  const left = String(player).padStart(2, "0");
  const right = String(ai).padStart(2, "0");
  const leftW = measurePixelText(left, 2);
  const rightW = measurePixelText(right, 2);
  const gap = 20;
  const total = leftW + gap + rightW;
  const startX = Math.round((FIELD - total) / 2);
  const textY = y + 8;

  drawPixelText(ctx, left, startX, textY, 2, P.mint, P.void);
  drawPixelText(ctx, right, startX + leftW + gap, textY, 2, P.red, P.void);

  // 中间的冒号用像素点画，避开字库里的冒号高度。
  rect(ctx, startX + leftW + gap / 2 - 1, textY + 2, 2, 2, P.cream);
  rect(ctx, startX + leftW + gap / 2 - 1, textY + 8, 2, 2, P.cream);
  ctx.globalAlpha = 1;
}

/** 提示条：单行像素字居中显示在球场中下部。 */
export function drawHint(
  ctx: CanvasRenderingContext2D,
  text: string,
  y: number,
  size = 1,
  color = P.lav,
  alpha = 1,
): void {
  const width = measurePixelText(text, size);
  ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
  drawPixelText(ctx, text, Math.round((FIELD - width) / 2), Math.round(y), size, color, P.void);
  ctx.globalAlpha = 1;
}

/* ---------------- 首页缩略图 ---------------- */

/**
 * 缩略图用的迷你竖屏球场：在 80×50 的卡片里画一块居中的方形场地。
 * 和游戏画面共用 drawBall / drawPaddle，保证同一套像素素材。
 */
export function drawMiniCourt(ctx: CanvasRenderingContext2D, box: Rect): void {
  const { x, y, w, h } = box;
  rect(ctx, x, y, w, h, P.night);
  rect(ctx, x, y, w, 1, P.line);
  rect(ctx, x, y + h - 1, w, 1, P.line);
  rect(ctx, x, y, 1, h, P.line);
  rect(ctx, x + w - 1, y, 1, h, P.line);

  // 中线
  const midY = y + Math.round(h / 2);
  for (let px = x + 2; px < x + w - 2; px += 4) rect(ctx, px, midY, 2, 1, P.line);
}

/** 迷你挡板：缩略图里的挡板比实战窄，长度按比例缩到 3/4。 */
export function drawMiniPaddle(
  ctx: CanvasRenderingContext2D,
  centerX: number,
  planeY: number,
  width: number,
  tone: PaddleTone = PLAYER_TONE,
): void {
  const x = Math.round(centerX - width / 2);
  const y = Math.round(planeY);
  rect(ctx, x, y, width, 2, tone.body);
  rect(ctx, x, y, width, 1, tone.light);
}
