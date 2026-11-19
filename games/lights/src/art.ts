import { P, bevel, rect, strokeRect, wave } from "@arcade/core";

import { CELLS, SIZE } from "./logic";

/** 逻辑分辨率，和 meta.size 保持一致。 */
export const VIEW_W = 168;
export const VIEW_H = 168;

/** 棋盘几何：26px 灯座 + 2px 缝，5×5 正好 138，左右各留 15。 */
export const CELL = 26;
export const GAP = 2;
export const STEP = CELL + GAP;
export const BOARD = SIZE * STEP - GAP;
export const ORIGIN_X = Math.round((VIEW_W - BOARD) / 2);
export const ORIGIN_Y = 16;

export const cellX = (col: number): number => ORIGIN_X + col * STEP;
export const cellY = (row: number): number => ORIGIN_Y + row * STEP;

/** 逻辑坐标 → 灯位序号；落在缝里或棋盘外返回 -1。 */
export function cellAt(x: number, y: number): number {
  const rx = x - ORIGIN_X;
  const ry = y - ORIGIN_Y;
  if (rx < 0 || ry < 0) return -1;
  const col = Math.floor(rx / STEP);
  const row = Math.floor(ry / STEP);
  if (col < 0 || col >= SIZE || row < 0 || row >= SIZE) return -1;
  if (rx - col * STEP >= CELL || ry - row * STEP >= CELL) return -1;
  return row * SIZE + col;
}

/** 静态底：夜色、棋盘外框、灯座凹槽。每帧重画也很便宜，不建离屏 canvas。 */
export function paintBackdrop(ctx: CanvasRenderingContext2D): void {
  rect(ctx, 0, 0, VIEW_W, VIEW_H, P.night);
  rect(ctx, 0, 0, VIEW_W, 1, P.line);
  rect(ctx, 0, VIEW_H - 1, VIEW_W, 1, P.line);

  rect(ctx, ORIGIN_X - 5, ORIGIN_Y - 5, BOARD + 10, BOARD + 10, P.void);
  strokeRect(ctx, ORIGIN_X - 5, ORIGIN_Y - 5, BOARD + 10, BOARD + 10, P.line);
  rect(ctx, ORIGIN_X - 2, ORIGIN_Y - 2, BOARD + 4, BOARD + 4, P.hole);
}

/**
 * 一盏灯。
 * 亮：琥珀灯面 + 金色斜切 + 奶白灯芯（pulse 高时灯芯转纯白）。
 * 灭：下沉的暗格，中间一颗死灯泡。
 */
export function drawLamp(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  lit: boolean,
  pulse = 0,
): void {
  if (lit) {
    rect(ctx, x, y, size, size, P.panel);
    rect(ctx, x + 1, y + 1, size - 2, size - 2, P.amber);
    bevel(ctx, x, y, size, size, P.gold, P.orange);

    const core = Math.round(size * 0.42);
    const cx = x + Math.round((size - core) / 2);
    const cy = y + Math.round((size - core) / 2);
    rect(ctx, cx, cy, core, core, P.gold);
    rect(ctx, cx + 2, cy + 2, core - 4, core - 4, pulse > 0.55 ? P.white : P.cream);
    rect(ctx, x + Math.floor(size / 2) - 1, y + Math.floor(size / 2) - 1, 2, 2, P.white);
    return;
  }

  rect(ctx, x, y, size, size, P.panel2);
  bevel(ctx, x, y, size, size, P.void, P.line);
  rect(ctx, x + 3, y + 3, size - 6, size - 6, P.hole);
  const dot = Math.floor(size / 2) - 1;
  rect(ctx, x + dot, y + dot, 2, 2, P.line);
  rect(ctx, x + dot - 4, y + dot, 1, 2, P.panel);
  rect(ctx, x + dot + 5, y + dot, 1, 2, P.panel);
}

/** 四角括线：键盘光标与鼠标悬停共用。 */
export function drawCorners(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  color: string,
  pad = 1,
  arm = 6,
): void {
  const left = x + pad;
  const top = y + pad;
  const right = x + size - pad - 1;
  const bottom = y + size - pad - 1;

  rect(ctx, left, top, arm, 1, color);
  rect(ctx, left, top, 1, arm, color);
  rect(ctx, right - arm + 1, top, arm, 1, color);
  rect(ctx, right, top, 1, arm, color);
  rect(ctx, left, bottom, arm, 1, color);
  rect(ctx, left, bottom - arm + 1, 1, arm, color);
  rect(ctx, right - arm + 1, bottom, arm, 1, color);
  rect(ctx, right, bottom - arm + 1, 1, arm, color);
}

const PIP = 5;
const PIP_GAP = 3;

/** 顶部五颗关卡指示灯：已过关薄荷、当前关金色呼吸、未到暗格。 */
export function drawLevelPips(
  ctx: CanvasRenderingContext2D,
  level: number,
  total: number,
  time: number,
): void {
  const width = total * PIP + (total - 1) * PIP_GAP;
  const x0 = Math.round((VIEW_W - width) / 2);
  const y = 5;

  for (let i = 0; i < total; i += 1) {
    const x = x0 + i * (PIP + PIP_GAP);
    if (i < level - 1) {
      rect(ctx, x, y, PIP, PIP, P.mint);
      rect(ctx, x, y, PIP, 1, P.white);
      continue;
    }
    if (i === level - 1) {
      const on = wave(time, 1.2) > 0.5;
      rect(ctx, x, y, PIP, PIP, on ? P.gold : P.amber);
      rect(ctx, x, y, PIP, 1, P.cream);
      continue;
    }
    rect(ctx, x, y, PIP, PIP, P.panel);
    strokeRect(ctx, x, y, PIP, PIP, P.line);
  }
}

/** 缩略图里的定妆盘面：亮成一个十字，一眼看出「点灯 / 关灯」。 */
const MINI: readonly number[] = [
  0, 0, 1, 0, 0,
  0, 1, 1, 1, 0,
  1, 1, 1, 1, 1,
  0, 1, 1, 1, 0,
  0, 0, 1, 0, 0,
];

/** 首页缩略图：80×50 逻辑像素，和游戏画面共用同一套调色板与灯位逻辑。 */
export function drawThumb(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  time: number,
): void {
  rect(ctx, 0, 0, w, h, P.night);
  rect(ctx, 0, 0, w, 1, P.line);
  rect(ctx, 0, h - 1, w, 1, P.line);

  const cell = 7;
  const gap = 1;
  const board = SIZE * cell + (SIZE - 1) * gap;
  const ox = Math.round((w - board) / 2);
  const oy = Math.round((h - board) / 2);

  rect(ctx, ox - 2, oy - 2, board + 4, board + 4, P.void);
  strokeRect(ctx, ox - 2, oy - 2, board + 4, board + 4, P.line);

  const pulse = wave(time, 0.9) > 0.5;
  for (let index = 0; index < CELLS; index += 1) {
    const x = ox + (index % SIZE) * (cell + gap);
    const y = oy + Math.floor(index / SIZE) * (cell + gap);

    if (MINI[index]) {
      const hot = pulse && index === Math.floor(CELLS / 2);
      rect(ctx, x, y, cell, cell, hot ? P.cream : P.amber);
      rect(ctx, x + 1, y + 1, cell - 2, cell - 2, hot ? P.white : P.gold);
      continue;
    }

    rect(ctx, x, y, cell, cell, P.panel2);
    rect(ctx, x + 2, y + 2, cell - 4, cell - 4, P.hole);
  }
}
