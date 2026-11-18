import { P, rect, sparkle } from "@arcade/core";

/**
 * 贪吃蛇的像素素材：
 * - 棋盘外框 + 淡网格（只画一次，缓存到离屏 canvas）
 * - 蛇身 / 蛇头
 * - 红金像素苹果
 *
 * 所有尺寸按逻辑像素，坐标由调用方给出格子左上角。
 */

export const CELL = 10;
export const PAD = 4;

const GRID = 16;

export type HeadDir = "up" | "down" | "left" | "right";
export type SegmentKind = "body" | "tail";

/** 168×168 棋盘：4px 外框、16×16 淡网格、内框高光与四角铆钉。 */
export function paintBoard(ctx: CanvasRenderingContext2D, size: number): void {
  rect(ctx, 0, 0, size, size, P.line);
  rect(ctx, PAD, PAD, size - PAD * 2, size - PAD * 2, P.night);

  // 网格淡纹：低透明度 P.line，落在每个 cell 的边界上
  ctx.save();
  ctx.globalAlpha = 0.38;
  for (let i = 1; i < GRID; i += 1) {
    const p = PAD + i * CELL;
    rect(ctx, p, PAD, 1, size - PAD * 2, P.line);
    rect(ctx, PAD, p, size - PAD * 2, 1, P.line);
  }
  ctx.restore();

  // 内框高光，让 4px 边框有厚度
  rect(ctx, PAD, PAD, size - PAD * 2, 1, P.lineHi);
  rect(ctx, PAD, size - PAD - 1, size - PAD * 2, 1, P.lineHi);
  rect(ctx, PAD, PAD, 1, size - PAD * 2, P.lineHi);
  rect(ctx, size - PAD - 1, PAD, 1, size - PAD * 2, P.lineHi);

  // 四角铆钉
  rect(ctx, 1, 1, 2, 2, P.lineHi);
  rect(ctx, size - 3, 1, 2, 2, P.lineHi);
  rect(ctx, 1, size - 3, 2, 2, P.lineHi);
  rect(ctx, size - 3, size - 3, 2, 2, P.lineHi);
}

/** 蛇身：身体 P.grassHi，尾巴 P.grass；顶部 1px 高光、底部 1px 暗边。 */
export function drawSnakeSegment(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  kind: SegmentKind,
  seed = 0,
): void {
  const px = Math.round(x);
  const py = Math.round(y);
  const base = kind === "tail" ? P.grass : P.grassHi;
  const top = kind === "tail" ? P.grassHi : P.mint;

  // 切掉四个角，连续身体看起来就像圆润的像素条
  rect(ctx, px + 1, py, CELL - 2, CELL, base);
  rect(ctx, px, py + 1, CELL, CELL - 2, base);
  rect(ctx, px + 1, py, CELL - 2, 1, top);
  rect(ctx, px + 1, py + CELL - 1, CELL - 2, 1, P.grassDeep);

  // 鳞片：相邻节错开 1px 的暗点
  const ox = seed % 2 === 0 ? 3 : 4;
  rect(ctx, px + ox, py + 4, 2, 2, P.grass);
  if (kind === "body") rect(ctx, px + ox + 2, py + 6, 1, 1, P.grass);
}

/**
 * 蛇头：P.mint 方块 + 顶部奶白高光 + 方向眼睛（1px 白点 + 1px 暗窝），
 * 移动时吐 2px 红信子。
 */
export function drawSnakeHead(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  dir: HeadDir,
  tongue: boolean,
): void {
  const px = Math.round(x);
  const py = Math.round(y);

  rect(ctx, px + 1, py, CELL - 2, CELL, P.mint);
  rect(ctx, px, py + 1, CELL, CELL - 2, P.mint);
  rect(ctx, px + 1, py, CELL - 2, 1, P.cream);
  rect(ctx, px + 1, py + CELL - 1, CELL - 2, 1, P.grassHi);

  // 眼睛：ex/ey 是第一只眼，ox/oy 是两眼间距，bx/by 指向脑后
  let ex = 7;
  let ey = 2;
  let ox = 0;
  let oy = 4;
  let bx = -1;
  let by = 0;
  if (dir === "left") {
    ex = 2;
    bx = 1;
  } else if (dir === "up") {
    ex = 2;
    ey = 2;
    ox = 4;
    oy = 0;
    bx = 0;
    by = 1;
  } else if (dir === "down") {
    ex = 2;
    ey = 7;
    ox = 4;
    oy = 0;
    bx = 0;
    by = -1;
  }

  for (let i = 0; i < 2; i += 1) {
    const ix = px + ex + ox * i;
    const iy = py + ey + oy * i;
    rect(ctx, ix, iy, 1, 1, P.white);
    rect(ctx, ix + bx, iy + by, 1, 1, P.void);
  }

  if (!tongue) return;
  if (dir === "right") {
    rect(ctx, px + CELL, py + 4, 2, 1, P.red);
    rect(ctx, px + CELL + 1, py + 3, 1, 1, P.red);
    rect(ctx, px + CELL + 1, py + 5, 1, 1, P.red);
  } else if (dir === "left") {
    rect(ctx, px - 2, py + 4, 2, 1, P.red);
    rect(ctx, px - 2, py + 3, 1, 1, P.red);
    rect(ctx, px - 2, py + 5, 1, 1, P.red);
  } else if (dir === "up") {
    rect(ctx, px + 4, py - 2, 1, 2, P.red);
    rect(ctx, px + 3, py - 2, 1, 1, P.red);
    rect(ctx, px + 5, py - 2, 1, 1, P.red);
  } else {
    rect(ctx, px + 5, py + CELL, 1, 2, P.red);
    rect(ctx, px + 4, py + CELL + 1, 1, 1, P.red);
    rect(ctx, px + 6, py + CELL + 1, 1, 1, P.red);
  }
}

/** 红/金像素苹果：果柄 P.dirt、叶子 P.grassHi、金高光，偶尔闪一下。 */
export function drawApple(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  time: number,
): void {
  const px = Math.round(x) + 2;
  const bob = Math.sin(time * 3.2) > 0.2 ? 0 : 1;
  const py = Math.round(y) + 2 + bob;

  // 果柄 + 叶子
  rect(ctx, px + 3, py - 1, 1, 2, P.dirt);
  rect(ctx, px + 4, py - 1, 2, 1, P.grassHi);

  // 果身（四角切掉 1px）
  rect(ctx, px + 1, py + 1, 4, 1, P.red);
  rect(ctx, px, py + 2, 6, 3, P.red);
  rect(ctx, px + 1, py + 5, 4, 1, P.red);

  // 右下暗部 + 金色高光
  rect(ctx, px + 4, py + 2, 2, 3, P.redDeep);
  rect(ctx, px + 1, py + 5, 4, 1, P.redDeep);
  rect(ctx, px + 1, py + 2, 1, 2, P.gold);
  rect(ctx, px + 2, py + 2, 1, 1, P.cream);

  if (Math.sin(time * 5 + x * 0.7) > 0.72) {
    sparkle(ctx, px + 6, py + 1, 1, P.gold, P.white);
  }
}
