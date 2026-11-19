import { P, bevel, rect, sparkle, strokeRect, wave } from "@arcade/core";

import { DOWN, LEFT, RIGHT, UP } from "./logic";

/** 管壁与管芯的像素宽度：管壁 8、管芯 4，正好在 20px 格里留 2px 边。 */
const TUBE = 8;
const CORE = 4;

/**
 * 一格管道。
 *
 * 一个格子画成「十字骨架」：中心方块 + 每个连通方向伸出去的一条臂。
 * 先画 8px 的管壁、再叠 4px 的管芯，中间自然留出 2px 的描边，
 * 所以弯曲、直管、丁字口都靠同一套代码，不需要分支。
 */
export function drawPipe(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  mask: number,
  wet = false,
): void {
  const half = Math.floor(size / 2);
  const to = Math.floor((size - TUBE) / 2);
  const tc = Math.floor((size - CORE) / 2);

  const shell = wet ? P.lav : P.line;
  const core = wet ? P.purple : P.panel2;

  // 中心枢纽
  rect(ctx, x + to, y + to, TUBE, TUBE, shell);
  rect(ctx, x + tc, y + tc, CORE, CORE, core);

  if ((mask & UP) !== 0) {
    rect(ctx, x + to, y, TUBE, half, shell);
    rect(ctx, x + tc, y, CORE, half, core);
  }
  if ((mask & DOWN) !== 0) {
    rect(ctx, x + to, y + half, TUBE, half, shell);
    rect(ctx, x + tc, y + half, CORE, half, core);
  }
  if ((mask & LEFT) !== 0) {
    rect(ctx, x, y + to, half, TUBE, shell);
    rect(ctx, x, y + tc, half, CORE, core);
  }
  if ((mask & RIGHT) !== 0) {
    rect(ctx, x + half, y + to, half, TUBE, shell);
    rect(ctx, x + half, y + tc, half, CORE, core);
  }

  // 管芯中央的一点高光：有水时亮一档，一眼能看出哪一段通水。
  if (wet) rect(ctx, x + tc, y + tc, 2, 2, P.cream);
}

/** 格子的暗底，让没有管道的格子也有落位感。 */
export function drawSlot(ctx: CanvasRenderingContext2D, x: number, y: number, size: number): void {
  rect(ctx, x, y, size, size, P.void);
  rect(ctx, x, y, size, 1, P.panel);
  rect(ctx, x, y, 1, size, P.panel);
}

/** 四角括线：键盘光标 / 鼠标悬停。 */
export function drawCorners(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  color: string,
  pad = 1,
  arm = 5,
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

/** 表格外的水源口：水从左侧流进来。 */
export function drawInlet(ctx: CanvasRenderingContext2D, x: number, cy: number, t: number): void {
  const flow = wave(t, 0.9);
  rect(ctx, x, cy - 3, 8, 7, P.lav);
  rect(ctx, x + 2, cy - 1, 6, 3, P.purple);
  rect(ctx, x + 6, cy - 3, 2, 7, P.cream);
  // 三颗水滴循环流向棋盘，给「水在往这边来」的动感。
  for (let i = 0; i < 3; i += 1) {
    const phase = (flow + i / 3) % 1;
    const dx = Math.round(x + phase * 6);
    rect(ctx, dx, cy - 1, 1, 1, P.cream);
  }
}

/** 表格外的出口：水从右侧流出去，通了之后会亮起来。 */
export function drawOutlet(
  ctx: CanvasRenderingContext2D,
  x: number,
  cy: number,
  open: boolean,
): void {
  const color = open ? P.lav : P.line;
  const core = open ? P.cream : P.panel2;
  rect(ctx, x, cy - 3, 8, 7, color);
  rect(ctx, x, cy - 1, 6, 3, core);
  rect(ctx, x + 6, cy - 3, 2, 7, color);
}

/** 漏水：喷出去的一小股红色水花。 */
export function drawLeak(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  dir: number,
  t: number,
): void {
  const pulse = 1 + Math.round(wave(t, 3) * 2);
  const dx = dir === LEFT ? -1 : dir === RIGHT ? 1 : 0;
  const dy = dir === UP ? -1 : dir === DOWN ? 1 : 0;
  for (let step = 1; step <= 3 + pulse; step += 1) {
    const px = cx + dx * (6 + step * 3);
    const py = cy + dy * (6 + step * 3);
    const size = step < 3 ? 2 : 1;
    rect(ctx, px - (size >> 1), py - (size >> 1), size, size, step % 2 === 0 ? P.red : P.redDeep);
  }
}

/** 缩略图里的 4×3 小管道局：前两行已通水，最后一行还在等玩家转。 */
const THUMB_ROWS = [
  [0b1010, 0b1010, 0b1100],
  [0b0101, 0b0101, 0b0101],
  [0b0110, 0b0011, 0b1001],
] as const;

/** 缩略图：80×50 逻辑像素，和游戏画面共用同一套像素管道。 */
export function drawThumb(ctx: CanvasRenderingContext2D, w: number, h: number, t: number): void {
  rect(ctx, 0, 0, w, h, P.night);
  rect(ctx, 0, 0, w, 1, P.line);
  rect(ctx, 0, h - 1, w, 1, P.line);

  const cell = 12;
  const cols = 4;
  const rows = 3;
  const boardW = cols * cell;
  const boardH = rows * cell;
  const ox = Math.round((w - boardW) / 2);
  const oy = Math.round((h - boardH) / 2) + 1;

  rect(ctx, ox - 3, oy - 3, boardW + 6, boardH + 6, P.void);
  bevel(ctx, ox - 3, oy - 3, boardW + 6, boardH + 6, P.lineHi, P.void);

  // 前两行是「已通水」的定局，最后一行留给玩家自己转。
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const mask = THUMB_ROWS[row]?.[col] ?? 0;
      drawPipe(ctx, ox + col * cell, oy + row * cell, cell, mask, row < 2);
    }
  }

  // 水源 / 出口两个小端帽
  rect(ctx, ox - 6, oy + 3, 3, 6, P.lav);
  const open = wave(t, 0.7) > 0.4;
  rect(ctx, ox + boardW + 3, oy + boardH - 9, 3, 6, open ? P.lav : P.line);

  sparkle(ctx, ox + boardW - 2, oy + 5, open ? 2 : 1, P.gold, P.white);
  strokeRect(ctx, ox - 3, oy - 3, boardW + 6, boardH + 6, P.line);
}
