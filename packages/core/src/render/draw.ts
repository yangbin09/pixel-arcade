/** 像素绘图原语：全部按整数像素落笔，避免抗锯齿糊边。 */

export function rect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  color: string,
): void {
  const width = Math.round(w);
  const height = Math.round(h);
  if (width <= 0 || height <= 0) return;
  ctx.fillStyle = color;
  ctx.fillRect(Math.round(x), Math.round(y), width, height);
}

export function ellipseHalf(rx: number, ry: number, dy: number): number {
  const t = 1 - (dy * dy) / (ry * ry);
  if (t <= 0) return 0;
  return Math.round(rx * Math.sqrt(t));
}

export function fillEllipse(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  color: string,
): void {
  for (let dy = -ry; dy <= ry; dy += 1) {
    const half = ellipseHalf(rx, ry, dy);
    if (half > 0) rect(ctx, cx - half, cy + dy, half * 2, 1, color);
  }
}

/** 像素直线（Bresenham），用于激光、准星、连线。 */
export function line(
  ctx: CanvasRenderingContext2D,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  color: string,
  thickness = 1,
): void {
  let x = Math.round(x0);
  let y = Math.round(y0);
  const ex = Math.round(x1);
  const ey = Math.round(y1);
  const dx = Math.abs(ex - x);
  const dy = Math.abs(ey - y);
  const sx = x < ex ? 1 : -1;
  const sy = y < ey ? 1 : -1;
  let err = dx - dy;
  ctx.fillStyle = color;
  for (;;) {
    ctx.fillRect(x, y, thickness, thickness);
    if (x === ex && y === ey) break;
    const e2 = err * 2;
    if (e2 > -dy) {
      err -= dy;
      x += sx;
    }
    if (e2 < dx) {
      err += dx;
      y += sy;
    }
  }
}

/** 实心像素圆：用横条拼，边缘保留像素感。 */
export function fillCircle(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  radius: number,
  color: string,
): void {
  fillEllipse(ctx, cx, cy, radius, radius, color);
}

/** 四角像素星芒（得分、拾取反馈）。 */
export function sparkle(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  color: string,
  coreColor: string,
): void {
  rect(ctx, x - size, y, size * 2 + 1, 1, color);
  rect(ctx, x, y - size, 1, size * 2 + 1, color);
  rect(ctx, x, y, 1, 1, coreColor);
}

/** 描边矩形（砖块、卡片、棋盘格）。 */
export function strokeRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  color: string,
  thickness = 1,
): void {
  rect(ctx, x, y, w, thickness, color);
  rect(ctx, x, y + h - thickness, w, thickness, color);
  rect(ctx, x, y, thickness, h, color);
  rect(ctx, x + w - thickness, y, thickness, h, color);
}

/** 斜切高光，给方块/砖块一点体积感。 */
export function bevel(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  light: string,
  dark: string,
): void {
  rect(ctx, x, y, w - 2, 2, light);
  rect(ctx, x, y, 2, h - 2, light);
  rect(ctx, x + 2, y + h - 2, w - 2, 2, dark);
  rect(ctx, x + w - 2, y + 2, 2, h - 2, dark);
}
