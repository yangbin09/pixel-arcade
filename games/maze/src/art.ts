import {
  P,
  bevel,
  drawPixelText,
  fillCircle,
  measurePixelText,
  rect,
  sparkle,
  strokeRect,
} from "@arcade/core";

/** 棋盘格尺寸（和 logic.ts 的 CELL 一致；这里复制一份避免 art 依赖逻辑常量）。 */
const TILE = 12;

/** 墙块：深色石块 + 顶部高光，远看像一堵砖墙。 */
export function drawWall(ctx: CanvasRenderingContext2D, x: number, y: number, size = TILE): void {
  rect(ctx, x, y, size, size, P.panel2);
  bevel(ctx, x, y, size, size, P.lineHi, P.void);
  if (size >= 10) {
    rect(ctx, x + 3, y + 5, size - 6, 1, P.line);
    rect(ctx, x + 3, y + 8, size - 8, 1, P.line);
  }
}

/** 走廊地砖：走过的格子亮一档，当前视野内的格子暗一档。 */
export function drawFloor(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size = TILE,
  explored = false,
): void {
  rect(ctx, x, y, size, size, explored ? P.panel : P.night);
  rect(ctx, x, y, size, 1, explored ? P.lineHi : P.line);
  if (explored && size >= 10) rect(ctx, x + 4, y + 4, 2, 2, P.line);
}

/** 钥匙：金色小十字 + 呼吸光点。 */
export function drawKey(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  time: number,
  size = 4,
): void {
  const pulse = Math.floor(time * 4) % 2 === 0 ? 1 : 0;
  fillCircle(ctx, cx, cy, size + pulse, P.amber);
  fillCircle(ctx, cx, cy, size, P.gold);
  rect(ctx, cx - size - 1, cy, size * 2 + 3, 1, P.cream);
  rect(ctx, cx, cy - size - 1, 1, size * 2 + 3, P.cream);
  sparkle(ctx, cx, cy, 1, P.white, P.cream);
}

/** 出口：未激活时是熄灭的门框，激活后点亮成绿色传送门。 */
export function drawDoor(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  active: boolean,
  time: number,
  size = TILE,
): void {
  const inset = 2;
  const inner = size - inset * 2;
  rect(ctx, x, y, size, size, P.void);
  strokeRect(ctx, x + inset - 1, y + inset - 1, inner + 2, inner + 2, active ? P.mint : P.lineHi);
  if (!active) {
    drawPixelText(ctx, "?", x + Math.floor((size - measurePixelText("?", 1)) / 2), y + 3, 1, P.lav);
    return;
  }
  const pulse = Math.floor((time * 3) % 2);
  rect(ctx, x + inset, y + inset, inner, inner, P.grassDeep);
  rect(ctx, x + inset + 1, y + inset + 1, inner - 2, inner - 2, pulse ? P.grassHi : P.grass);
  rect(ctx, x + inset + 2, y + inset + 2, 1, inner - 4, P.mint);
}

/** 玩家：圆滚滚的小提灯，脚下有一圈微光。 */
export function drawPlayer(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  dir: "up" | "down" | "left" | "right",
  time: number,
): void {
  const bob = Math.floor(time * 6) % 2;
  const px = Math.round(cx);
  const py = Math.round(cy) - bob;

  ctx.save();
  ctx.globalAlpha = 0.22;
  fillCircle(ctx, px, Math.round(cy), 6, P.amber);
  ctx.restore();

  fillCircle(ctx, px, py, 3, P.cream);
  fillCircle(ctx, px + 1, py - 1, 1, P.white);
  // 朝向：一个 2px 的小眼睛
  const eye: Record<string, [number, number]> = {
    up: [px, py - 2],
    down: [px, py + 1],
    left: [px - 2, py],
    right: [px + 1, py],
  };
  const [ex, ey] = eye[dir] ?? [px, py];
  rect(ctx, ex, ey, 2, 1, P.void);
}

/** 玩家留下的标记：金色小菱形，用来记死路。 */
export function drawMark(ctx: CanvasRenderingContext2D, cx: number, cy: number): void {
  rect(ctx, cx - 1, cy - 2, 2, 1, P.gold);
  rect(ctx, cx - 2, cy - 1, 4, 1, P.gold);
  rect(ctx, cx - 1, cy, 2, 1, P.gold);
  rect(ctx, cx, cy + 1, 1, 1, P.amber);
}

/** 迷雾边缘：视野边界画一圈渐隐的暗色，让「看不清」有体积感。 */
export function drawFogEdge(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size = TILE,
): void {
  ctx.save();
  ctx.globalAlpha = 0.25;
  rect(ctx, x, y, size, 1, P.void);
  rect(ctx, x, y + size - 1, size, 1, P.void);
  rect(ctx, x, y, 1, size, P.void);
  rect(ctx, x + size - 1, y, 1, size, P.void);
  ctx.restore();
}

/** 缩略图用：一格 7px 的小迷宫砖。 */
export function drawMiniWall(ctx: CanvasRenderingContext2D, x: number, y: number, size: number): void {
  rect(ctx, x, y, size, size, P.panel2);
  bevel(ctx, x, y, size, size, P.lineHi, P.void);
}

export function drawMiniFloor(ctx: CanvasRenderingContext2D, x: number, y: number, size: number): void {
  rect(ctx, x, y, size, size, P.night);
  rect(ctx, x, y, size, 1, P.line);
}

export function drawMiniPlayer(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number): void {
  ctx.save();
  ctx.globalAlpha = 0.3;
  fillCircle(ctx, cx, cy, r + 2, P.amber);
  ctx.restore();
  fillCircle(ctx, cx, cy, r, P.cream);
  rect(ctx, cx, cy - 1, 1, 2, P.void);
}
