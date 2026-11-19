import {
  P,
  drawPixelText,
  measurePixelText,
  rect,
  sparkle,
  strokeRect,
  wave,
} from "@arcade/core";

import { SIZE, type Ship } from "./logic";

/**
 * 像素素材层：两排 8×8 棋盘、击中/落空标记、舰队血条与缩略图。
 *
 * 全部按整数像素落笔，颜色只从 `P.*` 取；缩略图和游戏画面共用同一套画法。
 * 本文件不 import DOM，只接收调用方传来的 CanvasRenderingContext2D。
 */

export const VIEW_W = 168;
export const VIEW_H = 168;

/** 棋盘几何：8px 格子 + 1px 缝，8 格正好 71。两块并排（左我方、右敌方）。 */
export const CELL = 8;
export const GAP = 1;
export const STEP = CELL + GAP;
export const BOARD = SIZE * STEP - GAP;
export const BOARD_Y = 34;
export const OWN_X = 7;
export const ENEMY_X = 90;

/** 棋盘下方的 YOU / CPU 标签、分隔线与中队血条。 */
export const LABEL_Y = 108;
export const RULE_Y = 116;
export const BAR_Y = 119;
export const BOTTOM_RULE_Y = 158;

/** 中队血条：每格舰体 4px 长、1px 间隔。 */
export const BAR_UNIT = 4;
export const BAR_GAP = 1;
export const BAR_H = 5;
export const BAR_STEP = 7;

export type Side = "own" | "enemy";

export const sideX = (side: Side): number => (side === "own" ? OWN_X : ENEMY_X);
export const cellX = (side: Side, col: number): number => sideX(side) + col * STEP;
export const cellY = (row: number): number => BOARD_Y + row * STEP;

/** 逻辑坐标 → 某一侧棋盘的格子序号；落在缝里或棋盘外返回 -1。 */
export function cellAtOn(side: Side, x: number, y: number): number {
  const rx = x - sideX(side);
  const ry = y - BOARD_Y;
  if (rx < 0 || ry < 0) return -1;
  const col = Math.floor(rx / STEP);
  const row = Math.floor(ry / STEP);
  if (col < 0 || col >= SIZE || row < 0 || row >= SIZE) return -1;
  if (rx - col * STEP >= CELL || ry - row * STEP >= CELL) return -1;
  return row * SIZE + col;
}

/** 玩家只能打敌方棋盘：点在别处返回 -1。 */
export function enemyCellAt(x: number, y: number): number {
  return cellAtOn("enemy", x, y);
}

/** 居中画一行像素字，返回宽度。`cy` 是文字顶边。 */
export function drawCenteredText(
  ctx: CanvasRenderingContext2D,
  text: string,
  centerX: number,
  cy: number,
  scale: number,
  color: string,
  shadow: string | null = null,
): number {
  const width = measurePixelText(text, scale);
  return drawPixelText(ctx, text, Math.round(centerX - width / 2), cy, scale, color, shadow);
}

/** 海面：夜色底 + 三条缓慢漂移的水波，t 为秒。 */
export function paintWater(ctx: CanvasRenderingContext2D, t: number): void {
  rect(ctx, 0, 0, VIEW_W, VIEW_H, P.night);

  for (let y = 2; y < VIEW_H; y += 7) {
    const drift = Math.round(wave(t, 0.25, -3, 3) + Math.sin(y * 0.4) * 2);
    rect(ctx, 4 + drift, y, 13, 1, P.panel);
    rect(ctx, 52 - drift, y + 3, 9, 1, P.panel);
    rect(ctx, 110 + drift, y + 1, 16, 1, P.panel);
    rect(ctx, 148 - drift, y + 4, 11, 1, P.panel);
  }

  rect(ctx, 0, 0, VIEW_W, 1, P.line);
  rect(ctx, 0, VIEW_H - 1, VIEW_W, 1, P.line);
}

/** 一块棋盘的底：深色框 + 一格一格的底板（格间 1px 缝露出底色）。 */
export function drawBoardBase(ctx: CanvasRenderingContext2D, side: Side, accent: string): void {
  const x = sideX(side);
  rect(ctx, x - 2, BOARD_Y - 2, BOARD + 4, BOARD + 4, P.void);
  strokeRect(ctx, x - 2, BOARD_Y - 2, BOARD + 4, BOARD + 4, accent);

  for (let row = 0; row < SIZE; row += 1) {
    for (let col = 0; col < SIZE; col += 1) {
      rect(ctx, cellX(side, col), cellY(row), CELL, CELL, P.panel);
    }
  }
}

/** 棋盘下方的标签（YOU / CPU 及其战况）。棋盘底边在 105，这里从 108 起。 */
export function drawBoardLabel(
  ctx: CanvasRenderingContext2D,
  side: Side,
  text: string,
  color: string,
): void {
  drawCenteredText(ctx, text, sideX(side) + BOARD / 2, LABEL_Y, 1, color);
}

/** 打空：正中一颗暗紫小点，尽量不抢视线。 */
export function drawMiss(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  rect(ctx, x, y, CELL, CELL, P.void);
  rect(ctx, x + 3, y + 3, 2, 2, P.purple);
}

/** 命中：橙色实心块 + 深红芯，刚打中时炸一圈星芒。 */
export function drawHit(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  fresh = false,
): void {
  rect(ctx, x, y, CELL, CELL, P.orange);
  rect(ctx, x + 1, y + 1, CELL - 2, CELL - 2, P.amber);
  rect(ctx, x + 3, y + 3, 2, 2, P.redDeep);
  if (fresh) sparkle(ctx, x + CELL / 2, y + CELL / 2, 3, P.gold, P.white);
}

/** 已沉舰体的残骸：暗红底 + 一格斜杠。 */
export function drawWreck(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  rect(ctx, x, y, CELL, CELL, P.redDeep);
  rect(ctx, x + 1, y + 1, 1, CELL - 2, P.red);
  rect(ctx, x + CELL - 2, y + 1, 1, CELL - 2, P.red);
}

/** 我方舰体：完好的用薄荷绿，被打中的转橙。 */
export function drawOwnHull(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  hit = false,
): void {
  if (hit) {
    drawHit(ctx, x, y);
    return;
  }
  rect(ctx, x, y, CELL, CELL, P.grassDeep);
  rect(ctx, x + 1, y + 1, CELL - 2, CELL - 2, P.grass);
  rect(ctx, x + 2, y + 3, CELL - 4, 2, P.mint);
}

/** 准星：四角括线，键盘光标与鼠标悬停共用。 */
export function drawCursor(ctx: CanvasRenderingContext2D, x: number, y: number, color: string): void {
  const left = x;
  const top = y;
  const right = x + CELL - 1;
  const bottom = y + CELL - 1;
  const arm = 3;

  rect(ctx, left, top, arm, 1, color);
  rect(ctx, left, top, 1, arm, color);
  rect(ctx, right - arm + 1, top, arm, 1, color);
  rect(ctx, right, top, 1, arm, color);
  rect(ctx, left, bottom, arm, 1, color);
  rect(ctx, left, bottom - arm + 1, 1, arm, color);
  rect(ctx, right - arm + 1, bottom, arm, 1, color);
  rect(ctx, right, bottom - arm + 1, 1, arm, color);
}

/** 顶部横幅：大号状态字 + 下面一行小字。棋盘从 34 起，所以横幅只占 0–30。 */
export function drawBanner(
  ctx: CanvasRenderingContext2D,
  main: string,
  sub: string,
  color: string,
): void {
  drawCenteredText(ctx, main, VIEW_W / 2, 3, 2, color, P.void);
  drawCenteredText(ctx, sub, VIEW_W / 2, 21, 1, P.lav);
}

/**
 * 中队血条：每艘舰画成一条由方块组成的小血条，被命中的格子变暗红。
 * 舰长的条更长，一眼能看出还剩几艘。
 */
export function drawFleetBars(
  ctx: CanvasRenderingContext2D,
  side: Side,
  ships: readonly Ship[],
  tint: string,
): void {
  const x = sideX(side);

  for (let i = 0; i < ships.length; i += 1) {
    const ship = ships[i] as Ship;
    const y = BAR_Y + i * BAR_STEP;
    const length = ship.cells.length;

    for (let cell = 0; cell < length; cell += 1) {
      const bx = x + cell * (BAR_UNIT + BAR_GAP);
      const hit = ship.hits.has(ship.cells[cell] as number);
      rect(ctx, bx, y, BAR_UNIT, BAR_H, hit ? P.redDeep : tint);
      if (!hit) rect(ctx, bx, y, BAR_UNIT, 1, P.panel2);
    }

    // 整艘沉了：底下压一条红线，一看就知道这艘没了。
    if (ship.cells.every((cell) => ship.hits.has(cell)) && length > 0) {
      rect(ctx, x, y + BAR_H + 1, length * (BAR_UNIT + BAR_GAP) - BAR_GAP, 1, P.red);
    }
  }
}

/** 分隔线：把棋盘区和血条区分开。 */
export function drawRule(ctx: CanvasRenderingContext2D, y: number): void {
  rect(ctx, 7, y, VIEW_W - 14, 1, P.line);
}

/**
 * 敌方战果：五颗格子方块，沉一艘亮一颗。
 *
 * 只暴露「沉了几艘」，不暴露每艘舰的受损位置 —— 否则等于把舰长信息送给玩家。
 */
export function drawSunkPips(
  ctx: CanvasRenderingContext2D,
  side: Side,
  ships: readonly Ship[],
  litColor: string,
): void {
  const x = sideX(side);
  const y = BAR_Y + 4;

  for (let i = 0; i < ships.length; i += 1) {
    const ship = ships[i] as Ship;
    const sunk = ship.cells.every((cell) => ship.hits.has(cell));
    const px = x + i * (CELL + 3);
    if (sunk) {
      rect(ctx, px, y, CELL, BAR_H, litColor);
      rect(ctx, px + 1, y + 1, CELL - 2, BAR_H - 2, P.amber);
    } else {
      rect(ctx, px, y, CELL, BAR_H, P.panel2);
      rect(ctx, px, y, CELL, 1, P.line);
    }
  }
}

/** 首页缩略图（80×50）：左边一艘战舰剪影，右边一张打了几炮的敌方格。 */
export function drawThumb(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  t: number,
): void {
  rect(ctx, 0, 0, w, h, P.night);
  rect(ctx, 0, 0, w, 1, P.line);
  rect(ctx, 0, h - 1, w, 1, P.line);

  // 水波
  for (let y = 8; y < h; y += 7) {
    const drift = Math.round(wave(t, 0.3, -2, 2));
    rect(ctx, 3 + drift, y, 11, 1, P.panel);
    rect(ctx, 22 - drift, y + 3, 7, 1, P.panel);
    rect(ctx, 63 + drift, y + 1, 13, 1, P.panel);
  }

  // 左边的战舰：船体 + 上层建筑 + 炮塔
  const hullY = 30;
  rect(ctx, 6, hullY, 28, 6, P.grassDeep);
  rect(ctx, 8, hullY - 4, 22, 4, P.grass);
  rect(ctx, 8, hullY, 24, 2, P.mint);
  rect(ctx, 14, hullY - 7, 6, 3, P.grass);
  rect(ctx, 15, hullY - 9, 1, 2, P.cream);
  rect(ctx, 25, hullY - 6, 4, 2, P.lineHi);
  rect(ctx, 4, hullY + 6, 32, 1, P.grassDeep);

  // 右边 8×8 敌方格（4px 一格）
  const cell = 4;
  const ox = 46;
  const oy = 5;
  const board = cell * 8;
  rect(ctx, ox - 1, oy - 1, board + 2, board + 2, P.void);
  strokeRect(ctx, ox - 1, oy - 1, board + 2, board + 2, P.line);

  const shots = [
    { c: 1, r: 1, hit: false },
    { c: 4, r: 0, hit: false },
    { c: 5, r: 2, hit: true },
    { c: 6, r: 3, hit: true },
    { c: 2, r: 5, hit: false },
    { c: 7, r: 6, hit: false },
  ];

  for (let row = 0; row < 8; row += 1) {
    for (let col = 0; col < 8; col += 1) {
      rect(ctx, ox + col * cell, oy + row * cell, cell - 1, cell - 1, P.panel);
    }
  }

  for (const shot of shots) {
    const x = ox + shot.c * cell;
    const y = oy + shot.r * cell;
    if (shot.hit) {
      rect(ctx, x, y, cell - 1, cell - 1, P.orange);
      rect(ctx, x + 1, y + 1, cell - 3, cell - 3, P.amber);
    } else {
      rect(ctx, x + 1, y + 1, 2, 2, P.purple);
    }
  }

  const pulse = wave(t, 0.7) > 0.5;
  sparkle(ctx, ox + 6 * cell + 1, oy + 3 * cell + 1, pulse ? 3 : 2, P.gold, P.white);
}
