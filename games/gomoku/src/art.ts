import {
  P,
  drawPixelText,
  fillCircle,
  line,
  measurePixelText,
  rect,
  sparkle,
  strokeRect,
  wave,
} from "@arcade/core";

import { AI, CELL, ORIGIN, PLAYER, SIZE, cellCenter, indexToCell } from "./logic";

/** 逻辑分辨率，和 meta.size 保持一致（168×168 方形机台）。 */
export const VIEW_W = 168;
export const VIEW_H = 168;

/** 13 格 × 12px = 156 的棋盘。 */
export const BOARD = SIZE * CELL;

/** 棋子半径：12px 格子留 1px 边。 */
const stoneRadius = (size: number): number => Math.max(1, Math.floor(size / 2) - 1);

/**
 * 逻辑坐标 → 棋盘格序号；棋盘外返回 -1。
 *
 * 棋盘从 (6, 6) 起、每格 12px，所以整格都是有效热区（触屏友好），
 * 不像黑白棋那样有 1px 缝要避开。
 */
export function cellAt(x: number, y: number): number {
  const rx = x - ORIGIN;
  const ry = y - ORIGIN;
  if (rx < 0 || ry < 0) return -1;
  const col = Math.floor(rx / CELL);
  const row = Math.floor(ry / CELL);
  if (col < 0 || col >= SIZE || row < 0 || row >= SIZE) return -1;
  return row * SIZE + col;
}

/** 棋盘的左上角坐标（缩略图也复用这套几何）。 */
export const boardXY = (col: number, row: number, cell: number, ox: number, oy: number): { x: number; y: number } => ({
  x: ox + col * cell,
  y: oy + row * cell,
});

/** 棋盘上的星位：四个角星 + 天元，全部落在格心。 */
const STAR_POINTS: readonly (readonly [number, number])[] = [
  [3, 3],
  [9, 3],
  [3, 9],
  [9, 9],
  [6, 6],
];

/** 四角括线：键盘光标、鼠标悬停、最后一手共用。 */
export function drawCorners(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  color: string,
  pad = 0,
  arm = 4,
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

/**
 * 静态棋盘底：夜色 + 木色棋盘 + 网格线 + 星位。
 * `accent` 是外框 1px，用来标「该谁下」（我方金、对手红），不占棋盘面积。
 */
export function paintBackdrop(ctx: CanvasRenderingContext2D, accent: string): void {
  rect(ctx, 0, 0, VIEW_W, VIEW_H, P.night);
  rect(ctx, 0, 0, VIEW_W, 1, P.line);
  rect(ctx, 0, VIEW_H - 1, VIEW_W, 1, P.line);

  // 木色棋盘：外框 1px 强调线 + 深色描边 + 木纹底。
  rect(ctx, ORIGIN - 1, ORIGIN - 1, BOARD + 2, BOARD + 2, accent);
  rect(ctx, ORIGIN, ORIGIN, BOARD, BOARD, P.dirtDeep);
  rect(ctx, ORIGIN + 1, ORIGIN + 1, BOARD - 2, BOARD - 2, P.dirt);

  // 网格线落在格子边界上（6 + n*12），1px 深木色。
  for (let n = 1; n < SIZE; n += 1) {
    const offset = ORIGIN + n * CELL;
    rect(ctx, offset, ORIGIN, 1, BOARD, P.dirtDeep);
    rect(ctx, ORIGIN, offset, BOARD, 1, P.dirtDeep);
  }

  // 星位：2×2 深点，压在格心上。
  for (const [col, row] of STAR_POINTS) {
    const center = cellCenter(col, row);
    rect(ctx, center.x - 1, center.y - 1, 2, 2, P.hole);
  }
}

/**
 * 一枚棋子（黑白共用）。大格子画像素圆 + 高光，小格子（缩略图）退化成 3×3 点，
 * 两种尺寸共用同一份画法，缩略图和画面不会跑偏成两种风格。
 */
export function drawStone(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  who: number,
  size: number,
): void {
  if (size < 7) {
    const face = who === PLAYER ? P.void : P.cream;
    const shine = who === PLAYER ? P.lav : P.white;
    rect(ctx, cx - 1, cy - 1, 3, 3, who === PLAYER ? P.line : P.lav);
    rect(ctx, cx - 1, cy - 1, 2, 2, face);
    rect(ctx, cx - 1, cy - 1, 1, 1, shine);
    return;
  }

  const r = stoneRadius(size);
  const glow = Math.max(1, Math.floor(size / 4));

  if (who === PLAYER) {
    // 黑子在木色棋盘上要有一圈亮边才看得清：紫灰外圈 + 深线内圈 + 近黑棋面。
    fillCircle(ctx, cx, cy, r, P.purple);
    fillCircle(ctx, cx, cy, Math.max(1, r - 1), P.line);
    fillCircle(ctx, cx, cy, Math.max(1, r - 2), P.void);
    rect(ctx, cx - glow, cy - glow, glow + 1, 1, P.lav);
    rect(ctx, cx - glow, cy - glow, 1, glow + 1, P.lav);
    rect(ctx, cx - glow, cy - glow, 1, 1, P.white);
    return;
  }

  fillCircle(ctx, cx, cy, r, P.dirtHi);
  fillCircle(ctx, cx, cy, Math.max(1, r - 1), P.cream);
  rect(ctx, cx - glow, cy - glow, glow + 1, 1, P.white);
  rect(ctx, cx - glow, cy - glow, 1, glow + 1, P.white);
  rect(ctx, cx - Math.max(1, r - 3), cy + Math.max(1, r - 2), Math.max(2, r - 1), 1, P.lav);
}

/** 最后一手的小金角标，落在棋子左上，不抢棋子本身。 */
export function drawLastMove(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  rect(ctx, x + 1, y + 1, 3, 1, P.gold);
  rect(ctx, x + 1, y + 1, 1, 3, P.gold);
}

/** 连五的金色连线：沿五颗子的中心画一条 2px 粗线，一眼看清怎么赢的。 */
export function drawWinLine(
  ctx: CanvasRenderingContext2D,
  board: readonly number[],
  lineIndices: readonly number[],
): void {
  if (lineIndices.length < 2) return;
  const first = lineIndices[0] as number;
  const last = lineIndices[lineIndices.length - 1] as number;
  const a = indexToCell(first);
  const b = indexToCell(last);
  const from = cellCenter(a.col, a.row);
  const to = cellCenter(b.col, b.row);

  // 先画一圈暗底再压亮线，保证在黑白子和木色上都读得出来。
  line(ctx, from.x, from.y, to.x, to.y, P.void, 3);
  line(ctx, from.x, from.y, to.x, to.y, P.gold, 1);
  for (const index of lineIndices) {
    const cell = indexToCell(index);
    const center = cellCenter(cell.col, cell.row);
    if ((board[index] ?? 0) === 0) continue;
    sparkle(ctx, center.x, center.y, 1, P.white, P.gold);
  }
}

const PIP = 4;
const PIP_GAP = 3;

/**
 * 顶部三颗小局指示灯（画在画布顶部 6px 的留白里）。
 * outcomes: -1 未下 / 0 输 / 1 平 / 2 赢；current 是正在下的小局（1 起）。
 */
export function drawRoundPips(
  ctx: CanvasRenderingContext2D,
  outcomes: readonly number[],
  current: number,
  time: number,
): void {
  const total = outcomes.length;
  if (total === 0) return;
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
    if (i === current - 1) {
      rect(ctx, x, y, PIP, PIP, wave(time, 1.4) > 0.5 ? P.gold : P.orange);
      rect(ctx, x, y, PIP, 1, P.cream);
      continue;
    }
    rect(ctx, x, y, PIP, PIP, P.panel);
    strokeRect(ctx, x, y, PIP, PIP, P.line);
  }
}

/** 中场 / 终场横幅：一块暗牌 + 两行像素字，宽度跟着文字走。 */
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

  drawPixelText(ctx, title, Math.round((VIEW_W - titleW) / 2), y + padTop, titleSize, P.cream, P.void);
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

/** 缩略图里的定妆盘面：一局正下到中盘的对杀，黑棋斜向连四。 */
const MINI: readonly (readonly [number, number, number])[] = [
  [3, 3, PLAYER],
  [4, 3, AI],
  [5, 3, PLAYER],
  [6, 3, AI],
  [5, 4, PLAYER],
  [6, 4, AI],
  [7, 4, PLAYER],
  [5, 5, PLAYER],
  [6, 5, AI],
  [7, 5, PLAYER],
  [8, 5, AI],
  [6, 6, PLAYER],
  [7, 6, AI],
];

/** 首页缩略图：80×50 逻辑像素，与游戏画面共用 art.ts 的棋盘与棋子。 */
export function drawThumb(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  time: number,
): void {
  rect(ctx, 0, 0, w, h, P.night);
  rect(ctx, 0, 0, w, 1, P.line);
  rect(ctx, 0, h - 1, w, 1, P.line);

  const cell = 3;
  const board = SIZE * cell;
  const ox = Math.round((w - board) / 2);
  const oy = Math.round((h - board) / 2);

  rect(ctx, ox - 2, oy - 2, board + 4, board + 4, P.void);
  strokeRect(ctx, ox - 2, oy - 2, board + 4, board + 4, P.line);
  rect(ctx, ox - 1, oy - 1, board + 2, board + 2, P.dirtDeep);
  rect(ctx, ox, oy, board, board, P.dirt);

  // 只画很少几条网格线，3px 格子画满会糊成一片。
  for (let n = 2; n < SIZE; n += 2) {
    rect(ctx, ox + n * cell, oy, 1, board, P.dirtDeep);
    rect(ctx, ox, oy + n * cell, board, 1, P.dirtDeep);
  }

  for (const [col, row, who] of MINI) {
    const pos = boardXY(col, row, cell, ox, oy);
    drawStone(ctx, pos.x + 1, pos.y + 1, who, cell);
  }

  // 一颗呼吸的落子提示，让缩略图有「轮到你了」的动感。
  // 3px 格子放不下全尺寸括线，这里用 1px 短角标 + 中心亮点。
  const pulse = wave(time, 0.9) > 0.5;
  const hint = boardXY(8, 6, cell, ox, oy);
  drawCorners(ctx, hint.x - 1, hint.y - 1, cell + 2, pulse ? P.gold : P.amber, 0, 1);
  sparkle(ctx, hint.x + 1, hint.y + 1, 1, pulse ? P.gold : P.amber, P.white);
}
