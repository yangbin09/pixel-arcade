/**
 * rhythm 的像素素材：轨道底板、判定线、音符、击打反馈圈、缩略图砖块。
 * 全部只用 `P.*` 调色板，尺寸按逻辑像素，缩略图与游戏画面共用同一套画法。
 */

import {
  P,
  bevel,
  drawPixelText,
  fillCircle,
  measurePixelText,
  rect,
  sparkle,
} from "@arcade/core";

/** 四条轨道的配色：青 / 金 / 紫 / 粉，缩略图和画面共用。 */
export const LANE_COLORS: readonly string[] = [P.mint, P.gold, P.lav, P.pink];

/** 轨道底槽的颜色（比底色暗一档）。 */
export const LANE_DARK: readonly string[] = [P.grassDeep, P.dirtDeep, P.purple, P.redDeep];

export function laneColor(lane: number): string {
  return LANE_COLORS[((lane % LANE_COLORS.length) + LANE_COLORS.length) % LANE_COLORS.length] ?? P.cream;
}

export function laneDark(lane: number): string {
  return LANE_DARK[((lane % LANE_DARK.length) + LANE_DARK.length) % LANE_DARK.length] ?? P.panel;
}

/** 一条轨道的底槽：宽度固定 34，高度撑满。 */
export function drawLaneBed(
  ctx: CanvasRenderingContext2D,
  x: number,
  top: number,
  height: number,
  lane: number,
  hot = false,
): void {
  const w = 34;
  rect(ctx, x - w / 2, top, w, height, hot ? P.panel2 : P.panel);
  rect(ctx, x - w / 2, top, 1, height, P.line);
  rect(ctx, x + w / 2 - 1, top, 1, height, P.line);

  // 轨道中缝的一条虚线，用来读拍。
  for (let y = top + 4; y < top + height; y += 8) {
    rect(ctx, x, y, 1, 3, P.line);
  }

  if (hot) rect(ctx, x - w / 2, top, w, 1, laneColor(lane));
}

/** 判定线：横贯画面的双色线 + 两侧端点。 */
export function drawHitLine(ctx: CanvasRenderingContext2D, width: number, y: number, flash: number): void {
  const color = flash > 0.5 ? P.white : P.cream;
  rect(ctx, 0, y, width, 1, color);
  rect(ctx, 0, y + 1, width, 1, P.line);

  for (let lane = 0; lane < LANE_COLORS.length; lane += 1) {
    const w = 34;
    const x = 21 + lane * 42;
    rect(ctx, x - w / 2, y - 2, w, 1, laneColor(lane));
    rect(ctx, x - w / 2, y + 2, w, 1, laneDark(lane));
  }
}

/**
 * 一个音符：圆头长条 + 左侧高光。
 * `heat` 0..1 表示距离判定线多近（越近越亮）。
 */
export function drawNote(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  lane: number,
  heat = 0,
): void {
  const w = 26;
  const h = 8;
  const body = heat > 0.85 ? P.white : laneColor(lane);
  const edge = laneDark(lane);

  fillCircle(ctx, x - w / 2 + 4, y + h / 2, 4, edge);
  fillCircle(ctx, x + w / 2 - 4, y + h / 2, 4, edge);
  rect(ctx, x - w / 2 + 4, y, w - 8, h, edge);

  fillCircle(ctx, x - w / 2 + 4, y + h / 2, 3, body);
  fillCircle(ctx, x + w / 2 - 4, y + h / 2, 3, body);
  rect(ctx, x - w / 2 + 4, y + 1, w - 8, h - 2, body);

  rect(ctx, x - w / 2 + 5, y + 2, w - 10, 1, P.white);
}

/** 击打反馈圈：以判定线为中心向外扩散的方框，`life` 1 → 0。 */
export function drawHitBurst(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  life: number,
  color: string,
): void {
  const grow = Math.round((1 - life) * 12);
  const w = 26 + grow * 2;
  const h = 6 + grow;
  const top = y - h / 2;
  const left = x - w / 2;

  rect(ctx, left, top, w, 1, color);
  rect(ctx, left, top + h, w, 1, color);
  rect(ctx, left, top, 1, h, color);
  rect(ctx, left + w, top, 1, h, color);
}

/** 判定文字弹出：PERFECT / GOOD / MISS，scale 2 居中。 */
export function drawJudgeText(
  ctx: CanvasRenderingContext2D,
  text: string,
  cx: number,
  y: number,
  color: string,
): void {
  const width = measurePixelText(text, 2);
  drawPixelText(ctx, text, cx - width / 2, y, 2, color, P.void);
}

/** 节拍指示灯：四颗小方块，当前拍亮起的那颗用轨道色。 */
export function drawBeatLamp(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  index: number,
  on: boolean,
): void {
  const w = 6;
  const gap = 2;
  const left = x - (w * 4 + gap * 3) / 2;
  for (let i = 0; i < 4; i += 1) {
    const bx = left + i * (w + gap);
    if (on && i === index) {
      rect(ctx, bx, y, w, 3, laneColor(i));
      rect(ctx, bx, y - 1, w, 1, P.white);
    } else {
      rect(ctx, bx, y, w, 3, P.line);
    }
  }
}

/** 首页缩略图里的小音符条（80×50 空间里复用同一套配色）。 */
export function drawThumbNote(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  lane: number,
  width = 10,
): void {
  const h = 4;
  rect(ctx, x, y, width, h, laneDark(lane));
  rect(ctx, x + 1, y + 1, width - 2, h - 2, laneColor(lane));
  rect(ctx, x + 1, y + 1, width - 2, 1, P.white);
}

/** 缩略图里的斜切轨道块，复用 bevel 让素材看着像同一套。 */
export function drawThumbPad(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  lane: number,
): void {
  rect(ctx, x, y, w, h, laneDark(lane));
  bevel(ctx, x, y, w, h, P.lineHi, P.void);
  rect(ctx, x + 2, y + 2, w - 4, 1, laneColor(lane));
}

/** 缩略图收尾的闪光点，四轨各一颗，靠 wave 产生呼吸感。 */
export function drawThumbSparkle(ctx: CanvasRenderingContext2D, x: number, y: number, size: number): void {
  sparkle(ctx, x, y, size, P.gold, P.white);
}
