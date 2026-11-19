import {
  P,
  drawPixelText,
  fillCircle,
  measurePixelText,
  rect,
  strokeRect,
  wave,
} from "@arcade/core";

import { BLACK, SIZE, WHITE } from "./logic";

/** 逻辑分辨率，和 meta.size 保持一致（168×168 方形机台）。 */
export const VIEW_W = 168;
export const VIEW_H = 168;

/** 棋盘几何：19px 格子 + 1px 缝，从 (8, 8) 起，8×8 正好 159。 */
export const CELL = 19;
export const GAP = 1;
export const STEP = CELL + GAP;
export const ORIGIN = 8;
export const BOARD = SIZE * STEP - GAP;

export const cellX = (col: number): number => ORIGIN + col * STEP;
export const cellY = (row: number): number => ORIGIN + row * STEP;

/** 逻辑坐标 → 格子序号；落在缝里或棋盘外返回 -1。 */
export function cellAt(x: number, y: number): number {
  const rx = x - ORIGIN;
  const ry = y - ORIGIN;
  if (rx < 0 || ry < 0) return -1;
  const col = Math.floor(rx / STEP);
  const row = Math.floor(ry / STEP);
  if (col < 0 || col >= SIZE || row < 0 || row >= SIZE) return -1;
  if (rx - col * STEP >= CELL || ry - row * STEP >= CELL) return -1;
  return row * SIZE + col;
}

/**
 * 静态底：夜色 + 棋盘外框 + 网格。
 *
 * `accent` 是 1px 外框色，用来标「该谁下」（我方金、对手红），
 * 这样不占画布面积也能表达回合。
 */
export function paintBackdrop(ctx: CanvasRenderingContext2D, accent: string): void {
  rect(ctx, 0, 0, VIEW_W, VIEW_H, P.night);
  rect(ctx, 0, 0, VIEW_W, 1, P.line);
  rect(ctx, 0, VIEW_H - 1, VIEW_W, 1, P.line);

  // 外框：7..167 一圈 1px 强调线，里面直接是网格。
  rect(ctx, ORIGIN - 1, ORIGIN - 1, BOARD + 2, BOARD + 2, accent);
  // 网格底色：格子之间 1px 的缝隙露出来就是棋盘线。
  rect(ctx, ORIGIN, ORIGIN, BOARD, BOARD, P.grass);

  for (let row = 0; row < SIZE; row += 1) {
    for (let col = 0; col < SIZE; col += 1) {
      rect(ctx, cellX(col), cellY(row), CELL, CELL, P.grassDeep);
    }
  }

  // 格心再压 1px 高光，让绒布有一点起伏（不额外吃缝宽）。
  for (let row = 0; row < SIZE; row += 1) {
    for (let col = 0; col < SIZE; col += 1) {
      rect(ctx, cellX(col) + 2, cellY(row) + 2, CELL - 4, 1, P.grass);
    }
  }
}

/** 棋子半径：19px 格子里留 1px 边。 */
const discRadius = (size: number): number => Math.max(1, Math.floor(size / 2) - 1);

/**
 * 一枚棋子（黑白共用）。
 * 黑子：深底 + 紫灰高光；白子：奶白面 + 白高光 + 下方暗边。
 *
 * 大格子（19px）用像素圆（横条拼），小格子（缩略图 5px）退化成 3×3 的小圆点，
 * 两种尺寸共用同一份画法，缩略图和画面绝不会跑偏成两种风格。
 */
export function drawDisc(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  color: number,
): void {
  const cx = x + Math.floor(size / 2);
  const cy = y + Math.floor(size / 2);

  // 缩略图级别的小格子：3×3 圆点，高光只有 1px。
  if (size < 7) {
    const ring = color === BLACK ? P.line : P.lav;
    const face = color === BLACK ? P.void : P.cream;
    const shine = color === BLACK ? P.lav : P.white;
    const bx = cx - 1;
    const by = cy - 1;
    rect(ctx, bx, by, 3, 3, ring);
    rect(ctx, bx, by, 2, 2, face);
    rect(ctx, bx, by, 1, 1, shine);
    return;
  }

  const r = discRadius(size);
  // 19px → 3px 高光；再大也按这个比例走，不会画到隔壁格子。
  const glow = Math.max(2, Math.floor(size / 6));

  if (color === BLACK) {
    // 黑子在暗绿棋盘上要有一圈亮边才看得清：紫灰外圈 + 深线内圈 + 近黑棋面。
    fillCircle(ctx, cx, cy, r, P.purple);
    fillCircle(ctx, cx, cy, Math.max(1, r - 1), P.line);
    fillCircle(ctx, cx, cy, Math.max(1, r - 3), P.void);
    rect(ctx, cx - glow, cy - glow, glow, Math.max(1, Math.floor(glow / 2) + 1), P.lav);
    rect(ctx, cx - glow, cy - glow, 1, 1, P.white);
    return;
  }

  fillCircle(ctx, cx, cy, r, P.lav);
  fillCircle(ctx, cx, cy, Math.max(1, r - 2), P.cream);
  rect(ctx, cx - glow, cy - glow, glow, Math.max(1, Math.floor(glow / 2) + 1), P.white);
  rect(ctx, cx - Math.max(1, r - 4), cy + Math.max(2, r - 2), r, 1, P.lav);
}

/** 四角括线：键盘光标、鼠标悬停、最后一手共用。 */
export function drawCorners(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  color: string,
  pad = 0,
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

/** 合法手提示：中心方点 + 四角短线，`time` 控制呼吸。 */
export function drawHint(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  time: number,
): void {
  const cx = x + Math.floor(size / 2);
  const cy = y + Math.floor(size / 2);
  const hot = wave(time, 1.8) > 0.5;
  const ink = hot ? P.gold : P.amber;

  rect(ctx, cx - 1, cy - 1, 3, 3, ink);
  rect(ctx, cx, cy, 1, 1, P.white);

  const arm = 3;
  rect(ctx, cx - 5, cy - 5, arm, 1, ink);
  rect(ctx, cx - 5, cy - 5, 1, arm, ink);
  rect(ctx, cx + 3, cy - 5, arm, 1, ink);
  rect(ctx, cx + 5, cy - 5, 1, arm, ink);
  rect(ctx, cx - 5, cy + 5, arm, 1, ink);
  rect(ctx, cx - 5, cy + 3, 1, arm, ink);
  rect(ctx, cx + 3, cy + 5, arm, 1, ink);
  rect(ctx, cx + 5, cy + 3, 1, arm, ink);
}

/** 最后一手的小金点，落在格子左上角，不抢棋子本身。 */
export function drawLastMove(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  rect(ctx, x + 2, y + 2, 3, 3, P.gold);
  rect(ctx, x + 3, y + 3, 1, 1, P.white);
}

const PIP = 5;
const PIP_GAP = 3;

/**
 * 顶部三颗小局指示灯（画在画布顶部 8px 的留白里）。
 * outcomes: -1 未下 / 0 输 / 1 平 / 2 赢；current 是正在下的小局（1 起）。
 */
export function drawRoundPips(
  ctx: CanvasRenderingContext2D,
  outcomes: readonly number[],
  current: number,
  time: number,
): void {
  const total = outcomes.length;
  const width = total * PIP + (total - 1) * PIP_GAP;
  const x0 = Math.round((VIEW_W - width) / 2);
  const y = 1;

  for (let i = 0; i < total; i += 1) {
    const x = x0 + i * (PIP + PIP_GAP);
    const outcome = outcomes[i] ?? -1;

    if (outcome === 2) {
      rect(ctx, x, y, PIP, PIP, P.mint);
      rect(ctx, x, y, PIP, 1, P.white);
      continue;
    }
    if (outcome === 1) {
      rect(ctx, x, y, PIP, PIP, P.amber);
      rect(ctx, x, y, PIP, 1, P.cream);
      continue;
    }
    if (outcome === 0) {
      rect(ctx, x, y, PIP, PIP, P.redDeep);
      rect(ctx, x, y, PIP, 1, P.red);
      continue;
    }

    // 未下的小局：当前这颗金色呼吸，其余的暗格。
    if (i === current - 1) {
      const on = wave(time, 1.4) > 0.5;
      rect(ctx, x, y, PIP, PIP, on ? P.gold : P.orange);
      rect(ctx, x, y, PIP, 1, P.cream);
      continue;
    }
    rect(ctx, x, y, PIP, PIP, P.panel);
    strokeRect(ctx, x, y, PIP, PIP, P.line);
  }
}

/** 中场/终场的横幅：一块暗牌 + 两行像素字，宽度跟着文字走。 */
export function drawBanner(
  ctx: CanvasRenderingContext2D,
  title: string,
  subtitle: string,
  accent: string,
  centerY = VIEW_H / 2,
): void {
  const titleSize = 3;
  const subSize = 2;
  const titleH = 7 * titleSize;
  const subH = subtitle ? 7 * subSize : 0;
  const padTop = 6;
  const padBottom = 7;
  const lineGap = 5;

  const plateH = padTop + titleH + (subtitle ? lineGap + subH : 0) + padBottom;
  const titleW = measurePixelText(title, titleSize);
  const subW = subtitle ? measurePixelText(subtitle, subSize) : 0;
  const plateW = Math.min(VIEW_W - 8, Math.max(titleW, subW) + 20);
  const x = Math.round((VIEW_W - plateW) / 2);
  const y = Math.round(centerY - plateH / 2);

  rect(ctx, x, y, plateW, plateH, P.void);
  strokeRect(ctx, x, y, plateW, plateH, accent);
  rect(ctx, x + 1, y + 1, plateW - 2, 1, P.line);

  drawPixelText(
    ctx,
    title,
    Math.round((VIEW_W - titleW) / 2),
    y + padTop,
    titleSize,
    P.cream,
    P.void,
  );
  if (subtitle) {
    drawPixelText(
      ctx,
      subtitle,
      Math.round((VIEW_W - subW) / 2),
      y + padTop + titleH + lineGap,
      subSize,
      accent,
      P.void,
    );
  }
}

/** 缩略图里的定妆盘面：四角占满 + 中间一片纠缠，一眼看出黑白棋。 */
const MINI: readonly number[] = [
  BLACK, 0, 0, 0, 0, 0, 0, BLACK,
  0, BLACK, 0, 0, 0, 0, BLACK, 0,
  0, 0, WHITE, WHITE, WHITE, 0, 0, 0,
  0, 0, WHITE, BLACK, WHITE, WHITE, 0, 0,
  0, 0, 0, WHITE, BLACK, 0, 0, 0,
  0, 0, 0, WHITE, WHITE, BLACK, 0, 0,
  0, BLACK, 0, 0, 0, 0, BLACK, 0,
  BLACK, 0, 0, 0, 0, 0, 0, BLACK,
];

/** 首页缩略图：80×50 逻辑像素，与游戏画面共用 art.ts 的棋盘和棋子。 */
export function drawThumb(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  time: number,
): void {
  rect(ctx, 0, 0, w, h, P.night);
  rect(ctx, 0, 0, w, 1, P.line);
  rect(ctx, 0, h - 1, w, 1, P.line);

  const cell = 4;
  const gap = 1;
  const board = SIZE * cell + (SIZE - 1) * gap;
  const ox = Math.round((w - board) / 2);
  const oy = Math.round((h - board) / 2);

  rect(ctx, ox - 2, oy - 2, board + 4, board + 4, P.void);
  strokeRect(ctx, ox - 2, oy - 2, board + 4, board + 4, P.line);
  rect(ctx, ox - 1, oy - 1, board + 2, board + 2, P.grass);

  for (let row = 0; row < SIZE; row += 1) {
    for (let col = 0; col < SIZE; col += 1) {
      const x = ox + col * (cell + gap);
      const y = oy + row * (cell + gap);
      const disc = MINI[row * SIZE + col] ?? 0;
      rect(ctx, x, y, cell, cell, P.grassDeep);
      if (disc !== 0) drawDisc(ctx, x, y, cell, disc);
    }
  }

  // 一颗呼吸的合法手提示，让缩略图有「可以落子」的动感。
  const pulse = wave(time, 0.9) > 0.5;
  const hx = ox + 2 * (cell + gap);
  const hy = oy + 5 * (cell + gap);
  rect(ctx, hx + 1, hy + 1, 2, 2, pulse ? P.gold : P.amber);
  rect(ctx, hx + 1, hy + 1, 1, 1, P.white);
}
