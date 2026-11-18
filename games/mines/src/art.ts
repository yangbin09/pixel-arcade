import {
  P,
  bevel,
  drawPixelText,
  fillCircle,
  measurePixelText,
  rect,
} from "@arcade/core";

/** 数字 1–8 的颜色，按规格固定，缩略图和游戏画面共用。 */
export const NUM_COLORS: readonly string[] = [
  P.mint,
  P.gold,
  P.orange,
  P.red,
  P.lav,
  P.pink,
  P.cream,
  P.white,
];

/** 未开格：P.panel2 底 + 斜切高光；按下时反过来，像被压进去。 */
export function drawCovered(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  pressed = false,
): void {
  rect(ctx, x, y, size, size, pressed ? P.panel : P.panel2);
  if (pressed) bevel(ctx, x, y, size, size, P.void, P.lineHi);
  else bevel(ctx, x, y, size, size, P.lineHi, P.void);
  if (size >= 15) {
    const dot = Math.floor(size / 2) - 1;
    rect(ctx, x + dot, y + dot, 2, 2, P.line);
  }
}

/** 已开格：比场景底色亮一档，左上凹槽、右下细线，合起来像一块下沉的地砖。 */
export function drawOpen(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
): void {
  rect(ctx, x, y, size, size, P.night);
  rect(ctx, x, y, size, 1, P.void);
  rect(ctx, x, y, 1, size, P.void);
  rect(ctx, x + 1, y + size - 1, size - 1, 1, P.line);
  rect(ctx, x + size - 1, y + 1, 1, size - 1, P.line);
}

/** 邻雷数字：自动居中，textSize 1 用于首页缩略图。 */
export function drawNumber(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  cell: number,
  count: number,
  textSize = 2,
): void {
  if (count <= 0) return;
  const label = String(count);
  const color = NUM_COLORS[count - 1] ?? P.cream;
  const width = measurePixelText(label, textSize);
  const height = 7 * textSize;
  drawPixelText(
    ctx,
    label,
    x + Math.floor((cell - width) / 2),
    y + Math.floor((cell - height) / 2),
    textSize,
    color,
  );
}

/** 小三角旗：P.red 旗面 + P.cream 旗杆。 */
export function drawFlag(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
): void {
  const poleX = x + Math.floor(size / 2);
  const top = y + 3;
  const poleHeight = size - 6;
  rect(ctx, poleX, top, 1, poleHeight, P.cream);
  rect(ctx, poleX - 2, top + poleHeight - 1, 5, 1, P.cream);

  for (let row = 0; row < 4; row += 1) {
    rect(ctx, poleX + 1, top + row, 5 - row, 1, row === 3 ? P.redDeep : P.red);
  }
}

/** 像素水雷：圆球 + 十字尖刺 + 高光。 */
export function drawMine(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  radius: number,
  body: string = P.void,
  shine: string = P.cream,
): void {
  fillCircle(ctx, cx, cy, radius, body);
  rect(ctx, cx - radius - 2, cy, radius * 2 + 5, 1, body);
  rect(ctx, cx, cy - radius - 2, 1, radius * 2 + 5, body);
  rect(ctx, cx - radius + 1, cy - radius + 1, 2, 1, shine);
  rect(ctx, cx - radius + 1, cy - radius + 2, 1, 1, shine);
  rect(ctx, cx, cy, 1, 1, shine);
}

/** 四角括线：鼠标悬停和键盘光标用。 */
export function drawCorners(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  color: string,
  pad = 2,
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
