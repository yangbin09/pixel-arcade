import { P, rect, sparkle, strokeRect } from "@arcade/core";

import {
  CELL_H,
  LOG_H,
  ROWS,
  START_ROW,
  cellCenter,
  rowKind,
} from "./logic";

/** 每一行的顶部 y：行 0 在下、行 10 在上（格心见 logic.cellCenter）。 */
export const rowTop = (row: number): number => cellCenter(0, row).y - CELL_H / 2;

/** 车的四种配色；缩略图与游戏画面共用。 */
export const CAR_COLORS: readonly string[] = [P.red, P.amber, P.lav, P.mint];

/**
 * 静态背景：11 行色带（草岸 / 沥青 / 河面）+ 分隔线，只在 create 时画一次。
 * 之后每帧只画会动的车、浮木与青蛙。
 */
export function paintBackdrop(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  rect(ctx, 0, 0, w, h, P.night);

  for (let row = 0; row < ROWS; row += 1) {
    paintRowBand(ctx, row, rowTop(row), w);
  }

  // 车道与河道之间的分界：让 11 行读起来有层次
  for (let row = 1; row < ROWS; row += 1) {
    const y = rowTop(row);
    if (y <= 0 || y >= h) continue;
    rect(ctx, 0, y, w, 1, P.hole);
  }

  // 上下留白压暗，避免画面之外露出夜色
  const top = rowTop(ROWS - 1);
  if (top > 0) rect(ctx, 0, 0, w, top, P.night);
  const bottom = rowTop(START_ROW) + CELL_H;
  if (bottom < h) rect(ctx, 0, bottom, w, h - bottom, P.night);
}

/** 单行底色与纹理：起点草岸 / 车道沥青 / 河面水纹 / 终点草岸。 */
export function paintRowBand(
  ctx: CanvasRenderingContext2D,
  row: number,
  y: number,
  w: number,
): void {
  const kind = rowKind(row);

  if (kind === "start" || kind === "goal") {
    rect(ctx, 0, y, w, CELL_H, P.grassDeep);
    rect(ctx, 0, y, w, 2, P.grass);
    rect(ctx, 0, y + CELL_H - 2, w, 2, P.grassDeep);
    for (let x = 2; x < w; x += 9) {
      rect(ctx, x, y + 4, 4, 2, P.grass);
      rect(ctx, x + 1, y + 6, 3, 2, P.grassHi);
      rect(ctx, x + 2, y + 11, 2, 2, P.grassDeep);
    }
    if (kind === "goal") {
      // 对岸荷叶：给「到终点」一个明确的视觉目标
      for (let x = 6; x < w - 6; x += 21) {
        rect(ctx, x, y + 7, 9, 4, P.grass);
        rect(ctx, x + 1, y + 6, 7, 1, P.mint);
      }
    }
    return;
  }

  if (kind === "road") {
    rect(ctx, 0, y, w, CELL_H, P.panel);
    rect(ctx, 0, y, w, 1, P.panel2);
    // 虚线：按列距平铺，读起来像车道分隔
    for (let x = 1; x < w; x += 14) rect(ctx, x, y + Math.floor(CELL_H / 2), 7, 1, P.lineHi);
    return;
  }

  // 河：深水 + 波纹
  rect(ctx, 0, y, w, CELL_H, P.purple);
  rect(ctx, 0, y, w, 1, P.line);
  for (let x = -4; x < w; x += 13) {
    rect(ctx, x, y + 4, 6, 1, P.lav);
    rect(ctx, x + 5, y + 9, 5, 1, P.lineHi);
  }
}

/** 车：车身 + 车窗 + 车灯 + 轮胎，`variant` 决定配色。 */
export function drawCar(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  variant: number,
  dir: 1 | -1,
): void {
  const body = CAR_COLORS[Math.abs(variant) % CAR_COLORS.length] ?? P.red;
  const roof = variant % 2 === 0 ? P.cream : P.white;

  rect(ctx, x + 1, y + h - 3, w - 2, 2, P.void);
  rect(ctx, x, y + 1, w, h - 3, body);
  rect(ctx, x, y + 1, w, 1, roof);
  rect(ctx, x, y + h - 3, w, 1, P.redDeep);

  // 驾驶舱：偏车头一侧
  const cabinW = Math.max(4, w - 7);
  const cabinX = dir === 1 ? x + 4 : x + 3;
  rect(ctx, cabinX, y + 2, cabinW, 4, P.lineHi);
  rect(ctx, cabinX, y + 2, cabinW, 1, P.void);

  // 车灯朝行进方向
  const lampX = dir === 1 ? x + w - 2 : x + 1;
  rect(ctx, lampX, y + 4, 1, 2, P.gold);
  // 轮胎
  rect(ctx, x + 2, y + h - 1, 3, 1, P.void);
  rect(ctx, x + w - 5, y + h - 1, 3, 1, P.void);
}

/** 浮木：年轮 + 上下高光；被青蛙踩住时多画一道亮边。 */
export function drawLog(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  ridden = false,
): void {
  const bodyH = Math.max(3, Math.min(LOG_H, h));
  rect(ctx, x, y + 1, w, bodyH - 2, P.dirt);
  rect(ctx, x, y + 1, w, 2, P.dirtHi);
  rect(ctx, x, y + bodyH - 2, w, 2, P.dirtDeep);
  rect(ctx, x, y + 1, 2, bodyH - 2, P.dirtHi);
  rect(ctx, x + w - 2, y + 2, 2, Math.max(1, bodyH - 4), P.dirtDeep);

  // 年轮
  for (let i = 4; i < w - 4; i += 7) {
    rect(ctx, x + i, y + 4, 3, 2, P.dirtDeep);
    rect(ctx, x + i + 1, y + 7, 2, 1, P.dirtHi);
  }

  if (ridden) {
    rect(ctx, x + 2, y, w - 4, 1, P.grassHi);
    rect(ctx, x + 2, y + bodyH - 1, w - 4, 1, P.grassHi);
  }
}

export interface FrogOptions {
  /** 朝向：朝左时整只青蛙镜像。 */
  flip?: boolean;
  /** 腾空时收起后腿。 */
  airborne?: boolean;
  /** 时间（秒），用于眨眼。 */
  time?: number;
  /** 受伤闪烁：true 时只画一个剪影。 */
  hurt?: boolean;
}

/** 12×12 的像素青蛙：绿身、白瞳、收腿，中心和碰撞盒一致。 */
export function drawFrog(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  options: FrogOptions = {},
): void {
  const flip = options.flip ?? false;
  const airborne = options.airborne ?? false;
  const hurt = options.hurt ?? false;
  const body = hurt ? P.lav : P.grass;
  const shade = hurt ? P.purple : P.grassDeep;
  const shine = hurt ? P.cream : P.grassHi;
  const blink = Math.sin((options.time ?? 0) * 2.4) > 0.97;

  const paint = (): void => {
    // 后腿：腾空时收起
    const legY = airborne ? cy + 1 : cy + 2;
    rect(ctx, cx - 6, legY, 3, airborne ? 2 : 4, shade);
    rect(ctx, cx + 4, legY, 3, airborne ? 2 : 4, shade);
    if (!airborne) {
      rect(ctx, cx - 6, cy + 5, 4, 1, body);
      rect(ctx, cx + 3, cy + 5, 4, 1, body);
    }

    // 身体 + 背部高光
    rect(ctx, cx - 4, cy - 1, 9, 6, body);
    rect(ctx, cx - 3, cy, 7, 3, shine);

    // 头 + 凸起的眼睛
    rect(ctx, cx - 4, cy - 5, 9, 4, body);
    rect(ctx, cx - 5, cy - 6, 3, 3, body);
    rect(ctx, cx + 3, cy - 6, 3, 3, body);
    rect(ctx, cx - 5, cy - 6, 1, 1, blink ? shade : P.white);
    rect(ctx, cx + 4, cy - 6, 1, 1, blink ? shade : P.white);

    // 嘴
    rect(ctx, cx - 1, cy - 2, 3, 1, shade);
  };

  if (!flip) {
    paint();
    return;
  }
  ctx.save();
  ctx.translate(cx, 0);
  ctx.scale(-1, 1);
  ctx.translate(-cx, 0);
  paint();
  ctx.restore();
}

/** 落水涟漪：三圈由内向外扩散（0 → 1 播完）。 */
export function drawSplash(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  t: number,
): void {
  const k = t < 0 ? 0 : t > 1 ? 1 : t;
  const radius = 3 + Math.round(k * 9);
  const color = k > 0.6 ? P.lav : P.white;
  strokeRect(ctx, cx - radius, cy - Math.floor(radius / 2), radius * 2, Math.max(2, radius), color);
  if (k < 0.6) rect(ctx, cx - 1, cy - 1, 2, 2, P.white);
}

/** 撞车 / 落水的像素火花。 */
export function drawHitBurst(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  t: number,
  color: string,
): void {
  const k = t < 0 ? 0 : t > 1 ? 1 : t;
  const r = 3 + Math.round(k * 8);
  sparkle(ctx, cx, cy, r, color, P.white);
  if (k < 0.5) sparkle(ctx, cx, cy, Math.max(1, r - 3), P.cream, P.white);
}

/** 缩略图用的横向水面：80×50 里画一小段河。 */
export function paintWaterStrip(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  rect(ctx, x, y, w, h, P.purple);
  rect(ctx, x, y, w, 1, P.line);
  rect(ctx, x, y + h - 1, w, 1, P.line);
  for (let i = -4; i < w; i += 13) {
    rect(ctx, x + i, y + 3, 6, 1, P.lav);
    rect(ctx, x + i + 5, y + h - 4, 5, 1, P.lineHi);
  }
}
