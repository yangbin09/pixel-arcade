import {
  P,
  bevel,
  drawPixelText,
  measurePixelText,
  rect,
  strokeRect,
} from "@arcade/core";

import { COLS, ROWS, type PieceKind } from "./logic";

/**
 * 俄罗斯方块的像素素材：
 * - 棋盘底板（外框 + 16px 网格，缓存到离屏 canvas）
 * - 7 种方块配色与高光/暗边
 * - ghost 轮廓、next 预览小格
 * - 触屏按钮图标
 */

export const CELL = 16;
export const BOARD_X = 4;
export const BOARD_Y = 8;
export const BOARD_W = COLS * CELL;
export const BOARD_H = ROWS * CELL;

export interface BlockColors {
  fill: string;
  light: string;
  dark: string;
}

/** 7 种方块的颜色都从 P 里取，缩略图与游戏内保持一致。 */
export const PIECE_COLORS: Record<PieceKind, BlockColors> = {
  I: { fill: P.mint, light: P.white, dark: P.grass },
  O: { fill: P.gold, light: P.cream, dark: P.orange },
  T: { fill: P.lav, light: P.cream, dark: P.purple },
  S: { fill: P.grassHi, light: P.mint, dark: P.grass },
  Z: { fill: P.red, light: P.pink, dark: P.redDeep },
  J: { fill: P.purple, light: P.lav, dark: P.night },
  L: { fill: P.orange, light: P.amber, dark: P.redDeep },
};

export type TouchIcon = "left" | "right" | "rotate" | "drop";

/** 200×392 的静态底板：深色外框、棋盘网格、四角铆钉。 */
export function paintBoard(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  rect(ctx, 0, 0, w, h, P.night);
  rect(ctx, BOARD_X, BOARD_Y, BOARD_W, BOARD_H, P.void);

  // 淡网格：16px 一格，不抢方块的颜色
  for (let col = 1; col < COLS; col += 1) {
    rect(ctx, BOARD_X + col * CELL, BOARD_Y, 1, BOARD_H, P.panel2);
  }
  for (let row = 1; row < ROWS; row += 1) {
    rect(ctx, BOARD_X, BOARD_Y + row * CELL, BOARD_W, 1, P.panel2);
  }

  // 外框：1px 线 + 内侧高光，像一块街机面板
  strokeRect(ctx, BOARD_X - 1, BOARD_Y - 1, BOARD_W + 2, BOARD_H + 2, P.line);
  rect(ctx, BOARD_X, BOARD_Y, BOARD_W, 1, P.lineHi);
  rect(ctx, BOARD_X, BOARD_Y + BOARD_H - 1, BOARD_W, 1, P.line);
  rect(ctx, BOARD_X, BOARD_Y, 1, BOARD_H, P.lineHi);
  rect(ctx, BOARD_X + BOARD_W - 1, BOARD_Y, 1, BOARD_H, P.line);

  rect(ctx, 1, 3, 2, 2, P.lineHi);
  rect(ctx, w - 3, 3, 2, 2, P.lineHi);
  rect(ctx, 1, h - 5, 2, 2, P.lineHi);
  rect(ctx, w - 3, h - 5, 2, 2, P.lineHi);
}

/** 一个 16px 方块：内缩 1px，方便看清网格和堆叠层次。 */
export function drawBlock(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  kind: PieceKind,
  size = CELL,
): void {
  const colors = PIECE_COLORS[kind];
  const pad = size >= 10 ? 1 : 0;
  const inner = size - pad * 2;
  rect(ctx, x + pad, y + pad, inner, inner, colors.fill);
  bevel(ctx, x + pad, y + pad, inner, inner, colors.light, colors.dark);
}

/** ghost：20% 透明度的高光轮廓，只画边不填充。 */
export function drawGhostCell(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  kind: PieceKind,
): void {
  ctx.save();
  ctx.globalAlpha = 0.2;
  strokeRect(ctx, x + 2, y + 2, CELL - 4, CELL - 4, PIECE_COLORS[kind].light, 2);
  ctx.restore();
}

/** next 预览用的小方块（3–6px），只保留 1px 高光/暗边。 */
export function drawMiniBlock(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  kind: PieceKind,
): void {
  const colors = PIECE_COLORS[kind];
  rect(ctx, x, y, size, size, colors.fill);
  rect(ctx, x, y, size, 1, colors.light);
  rect(ctx, x, y, 1, size, colors.light);
  rect(ctx, x, y + size - 1, size, 1, colors.dark);
  rect(ctx, x + size - 1, y, 1, size, colors.dark);
}

const ICON_LEFT = [
  "#......",
  "##.....",
  "###....",
  "#######",
  "###....",
  "##.....",
  "#......",
] as const;

const ICON_RIGHT = [
  "......#",
  ".....##",
  "....###",
  "#######",
  "....###",
  ".....##",
  "......#",
] as const;

const ICON_DROP = [
  "....#....",
  "...###...",
  "..#####..",
  ".#######.",
  "....#....",
  "....#....",
  ".........",
  "#########",
] as const;

/** 把字符画贴到画布上，'#' 为实心像素。 */
function paintPattern(
  ctx: CanvasRenderingContext2D,
  rows: readonly string[],
  x: number,
  y: number,
  color: string,
): void {
  for (let row = 0; row < rows.length; row += 1) {
    const line = rows[row];
    for (let col = 0; col < line.length; col += 1) {
      if (line[col] === "#") rect(ctx, x + col, y + row, 1, 1, color);
    }
  }
}

/** 触屏按钮里的图标：左右箭头、旋转文字、硬降箭头。 */
export function drawTouchIcon(
  ctx: CanvasRenderingContext2D,
  icon: TouchIcon,
  x: number,
  y: number,
  w: number,
  h: number,
  color: string,
): void {
  if (icon === "rotate") {
    const label = "ROT";
    const width = measurePixelText(label, 2);
    drawPixelText(
      ctx,
      label,
      x + Math.round((w - width) / 2),
      y + Math.round((h - 14) / 2),
      2,
      color,
    );
    return;
  }

  const rows = icon === "left" ? ICON_LEFT : icon === "right" ? ICON_RIGHT : ICON_DROP;
  const px = x + Math.round((w - rows[0].length) / 2);
  const py = y + Math.round((h - rows.length) / 2);
  paintPattern(ctx, rows, px, py, color);
}
