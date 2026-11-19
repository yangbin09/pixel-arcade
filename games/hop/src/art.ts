import { P, bevel, rect, sparkle } from "@arcade/core";

/**
 * 青蛙过河的像素素材。全部按逻辑像素绘制，只用 `P` 调色板：
 * - 5 种行底色（home / water / safe / road / start）
 * - 15×14 青蛙（蹲 / 起跳两帧，可水平翻转）
 * - 木头（带年轮）、汽车（四种配色）
 * - 对岸荷叶、水面波纹、道路虚线
 */

import { CELL, COLS, FROG_HALF, WIDTH, rowKind } from "./logic";

/** 一格的高度就是 CELL，这里只做语义化。 */
const ROW_H = CELL;

/** 静态背景：按行铺底色与纹理，只在 create 时画一次。 */
export function paintBoard(ctx: CanvasRenderingContext2D, rows: number): void {
  for (let row = 0; row < rows; row += 1) {
    paintRowBand(ctx, row, row * ROW_H);
  }
}

/** 单独一行的底色与纹理。 */
export function paintRowBand(ctx: CanvasRenderingContext2D, row: number, y: number): void {
  switch (rowKind(row)) {
    case "home":
      paintHome(ctx, y);
      break;
    case "water":
      paintWater(ctx, y, row);
      break;
    case "road":
      paintRoad(ctx, y);
      break;
    case "start":
      paintStart(ctx, y);
      break;
    default:
      paintSafe(ctx, y);
      break;
  }
}

/** 对岸：深绿草坪 + 一排荷叶坑。 */
function paintHome(ctx: CanvasRenderingContext2D, y: number): void {
  rect(ctx, 0, y, WIDTH, ROW_H, P.grassDeep);
  rect(ctx, 0, y, WIDTH, 3, P.grass);
  rect(ctx, 0, y + ROW_H - 2, WIDTH, 2, P.grassHi);

  // 5 个荷叶床位：能被青蛙停靠的位置提示。
  for (let i = 0; i < COLS; i += 1) {
    const cx = i * CELL + CELL / 2;
    rect(ctx, cx - 7, y + 9, 14, 6, P.grassHi);
    rect(ctx, cx - 6, y + 8, 12, 8, P.grassHi);
    rect(ctx, cx - 4, y + 10, 8, 4, P.mint);
    rect(ctx, cx - 2, y + 11, 4, 2, P.grassDeep);
  }
  rect(ctx, 0, y + ROW_H - 1, WIDTH, 1, P.hole);
}

/** 河道：深蓝水面 + 会随行号错位的横向波纹。 */
function paintWater(ctx: CanvasRenderingContext2D, y: number, row: number): void {
  rect(ctx, 0, y, WIDTH, ROW_H, P.void);
  rect(ctx, 0, y + 1, WIDTH, ROW_H - 2, P.purple);
  ctx.save();
  ctx.globalAlpha = 0.35;
  rect(ctx, 0, y + 1, WIDTH, ROW_H - 2, P.panel);
  ctx.restore();
  rect(ctx, 0, y, WIDTH, 1, P.line);
  rect(ctx, 0, y + ROW_H - 1, WIDTH, 1, P.line);

  // 波纹：每行错开，静态但有水感。
  const shift = row % 2 === 0 ? 0 : 7;
  for (let x = -8; x < WIDTH; x += 22) {
    rect(ctx, x + shift, y + 6, 7, 1, P.lav);
    rect(ctx, x + shift + 3, y + 7, 5, 1, P.lineHi);
    rect(ctx, x + shift + 9, y + 16, 6, 1, P.lineHi);
  }
}

/** 安全带：草地 + 两行草尖。 */
function paintSafe(ctx: CanvasRenderingContext2D, y: number): void {
  rect(ctx, 0, y, WIDTH, ROW_H, P.grassDeep);
  rect(ctx, 0, y + 1, WIDTH, ROW_H - 2, P.grass);
  rect(ctx, 0, y, WIDTH, 1, P.grassHi);
  rect(ctx, 0, y + ROW_H - 1, WIDTH, 1, P.hole);
  for (let x = 2; x < WIDTH; x += 9) {
    rect(ctx, x, y + 5, 1, 3, P.grassHi);
    rect(ctx, x + 3, y + 15, 1, 4, P.grassDeep);
  }
}

/** 车道：沥青 + 中线虚线。 */
function paintRoad(ctx: CanvasRenderingContext2D, y: number): void {
  rect(ctx, 0, y, WIDTH, ROW_H, P.panel2);
  rect(ctx, 0, y + 1, WIDTH, ROW_H - 2, P.panel);
  rect(ctx, 0, y, WIDTH, 1, P.hole);
  rect(ctx, 0, y + ROW_H - 1, WIDTH, 1, P.hole);
  // 中央虚线：短划线，比实线更像马路。
  for (let x = 0; x < WIDTH; x += 12) rect(ctx, x, y + ROW_H / 2, 6, 1, P.lineHi);
}

/** 起点带：深草 + 一排起跑格。 */
function paintStart(ctx: CanvasRenderingContext2D, y: number): void {
  rect(ctx, 0, y, WIDTH, ROW_H, P.grassDeep);
  rect(ctx, 0, y, WIDTH, 2, P.grass);
  rect(ctx, 0, y + 2, WIDTH, ROW_H - 2, P.grassDeep);
  rect(ctx, 0, y + ROW_H - 3, WIDTH, 3, P.hole);
  for (let i = 0; i < COLS; i += 1) {
    const x = i * CELL + 2;
    rect(ctx, x, y + 7, CELL - 4, 9, P.grass);
    rect(ctx, x, y + 7, CELL - 4, 1, P.grassHi);
  }
}

/**
 * 木头：横放的圆木，两档宽度。
 * x / y 是左上角，w 是宽度，高固定 18。
 */
export function drawLog(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  variant: number,
  time: number,
): void {
  const top = y + 3;
  const h = 18;
  const px = Math.round(x);

  rect(ctx, px, top, w, h, P.dirt);
  bevel(ctx, px, top, w, h, P.dirtHi, P.dirtDeep);
  // 年轮：三段深浅交替，variant 决定偏移，让每根木头长得不一样。
  const offset = variant % 3;
  for (let i = 0; i < w - 8; i += 14) {
    const ringX = px + 5 + i + offset * 3;
    if (ringX + 6 > px + w - 3) break;
    rect(ctx, ringX, top + 4, 6, 1, P.dirtDeep);
    rect(ctx, ringX + 1, top + 7, 3, 1, P.dirtDeep);
    rect(ctx, ringX + 2, top + 11, 5, 1, P.dirtDeep);
  }
  // 两端年轮截面 + 高光
  rect(ctx, px, top + 2, 3, h - 4, P.dirtDeep);
  rect(ctx, px + 1, top + 3, 1, h - 6, P.dirtHi);
  rect(ctx, px + w - 3, top + 2, 3, h - 4, P.dirtDeep);
  rect(ctx, px + w - 2, top + 3, 1, h - 6, P.dirtHi);
  // 水花：随 time 轻轻晃动
  const bob = Math.sin(time * 4 + variant) > 0.4 ? 1 : 0;
  rect(ctx, px + 2, top + h - 1 + bob, w - 4, 1, P.lav);
}

/**
 * 汽车：三种车头，颜色按 variant 轮换。
 * x / y 是左上角，w 是宽度。
 */
export function drawCar(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  variant: number,
  time: number,
): void {
  const px = Math.round(x);
  const top = y + 4;
  const h = 16;

  const body =
    variant === 0 ? P.red : variant === 1 ? P.amber : variant === 2 ? P.mint : P.lav;
  const bodyHi =
    variant === 0 ? P.orange : variant === 1 ? P.gold : variant === 2 ? P.grassHi : P.cream;

  // 车身
  rect(ctx, px, top + 3, w, h - 4, body);
  bevel(ctx, px, top + 3, w, h - 4, bodyHi, P.redDeep);
  // 车顶
  const roofW = Math.max(8, w - 10);
  rect(ctx, px + 5, top, roofW, 4, body);
  rect(ctx, px + 6, top + 1, roofW - 2, 2, P.void);
  // 车窗
  rect(ctx, px + 8, top + 4, Math.max(4, roofW - 6), 4, P.lineHi);
  // 轮子
  rect(ctx, px + 3, top + h - 3, 4, 3, P.void);
  rect(ctx, px + w - 7, top + h - 3, 4, 3, P.void);
  // 车灯：眨眼
  const blink = Math.sin(time * 3 + variant * 1.7) > -0.3;
  rect(ctx, px + w - 2, top + 6, 1, 2, blink ? P.cream : P.amber);
  rect(ctx, px + 1, top + 6, 1, 2, P.red);
}

/**
 * 青蛙：15×14 像素，两帧（蹲 / 起跳），可水平翻转。
 * cx / cy 是中心点。蹲着时比格子略大，看起来更「有分量」。
 */
export function drawFrog(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  hop: boolean,
  flip: boolean,
  time: number,
): void {
  const x = Math.round(cx);
  const y = Math.round(cy);
  // 起跳帧整体抬高，蹲着时随呼吸上下 1px。
  const lift = hop ? -4 : 0;
  const wobble = hop ? 0 : Math.sin(time * 6) > 0.5 ? 1 : 0;
  const top = y - FROG_HALF + lift + wobble;

  // put(col, row, w, h)：col 以身体中线为 0，flip 时左右镜像。
  const put = (col: number, row: number, w: number, h: number, color: string): void => {
    const dx = flip ? -col - w : col;
    rect(ctx, x + dx, top + row, w, h, color);
  };

  // 后腿（起跳时收紧）
  if (hop) {
    put(-7, 9, 5, 3, P.grassDeep);
    put(2, 9, 5, 3, P.grassDeep);
  } else {
    put(-8, 9, 6, 4, P.grassDeep);
    put(2, 9, 6, 4, P.grassDeep);
    put(-8, 11, 3, 2, P.grass);
    put(5, 11, 3, 2, P.grass);
  }

  // 身体
  put(-6, 4, 12, 6, P.grass);
  put(-6, 3, 12, 1, P.grassHi);
  put(-5, 2, 10, 1, P.grassHi);
  put(-7, 6, 14, 3, P.grass);
  put(-6, 9, 12, 1, P.grassDeep);
  put(-7, 8, 14, 1, P.grassDeep);

  // 眼睛：两个凸起 + 白眼球 + 黑瞳孔
  put(-6, 0, 4, 4, P.grass);
  put(2, 0, 4, 4, P.grass);
  put(-6, 0, 4, 1, P.grassHi);
  put(2, 0, 4, 1, P.grassHi);
  put(-5, 1, 2, 2, P.white);
  put(3, 1, 2, 2, P.white);
  put(-5, 2, 1, 1, P.void);
  put(4, 2, 1, 1, P.void);

  // 嘴
  put(-3, 7, 6, 1, P.grassDeep);
  put(-1, 8, 2, 1, P.grassDeep);

  // 背部高光
  rect(ctx, x - 1, top + 5, 2, 2, P.mint);
}

/** 水面上的涟漪（落水时用）。 */
export function drawSplash(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  radius: number,
  color: string,
): void {
  const r = Math.max(2, Math.round(radius));
  rect(ctx, cx - r, cy, r * 2 + 1, 1, color);
  rect(ctx, cx - r - 3, cy - 3, 3, 1, color);
  rect(ctx, cx + r + 1, cy - 3, 3, 1, color);
  rect(ctx, cx - r + 2, cy + 3, 2, 1, color);
  rect(ctx, cx + r - 4, cy + 3, 2, 1, color);
  sparkle(ctx, cx, cy - 5, 1, P.white, P.cream);
}

/** HUD 之外的画布内进度提示：对岸小旗。 */
export function drawBankFlag(ctx: CanvasRenderingContext2D, x: number, y: number, time: number): void {
  rect(ctx, x, y - 8, 1, 9, P.cream);
  const flap = Math.sin(time * 5) > 0 ? 1 : 0;
  rect(ctx, x + 1, y - 8, 5, 3 + flap, P.red);
  rect(ctx, x + 1, y - 7, 3, 1, P.gold);
}
