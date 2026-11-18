import { P, bevel, rect, strokeRect } from "@arcade/core";

import { POWERUP_SIZE, brickPoints, type PowerUpKind } from "./logic";

interface BrickStyle {
  base: string;
  light: string;
  dark: string;
}

/** 三种分值各一套砖色：顶行红、中间琥珀、底行薄荷。 */
const BRICK_STYLES: Record<number, BrickStyle> = {
  30: { base: P.red, light: P.pink, dark: P.redDeep },
  20: { base: P.amber, light: P.gold, dark: P.orange },
  10: { base: P.mint, light: P.cream, dark: P.grass },
};

const FALLBACK_STYLE: BrickStyle = { base: P.amber, light: P.gold, dark: P.orange };

export function brickStyle(points: number): BrickStyle {
  return BRICK_STYLES[points] ?? FALLBACK_STYLE;
}

/** 18×8 的砖：暗底 + 高光斜面，碎掉时粒子取 base 色。 */
export function drawBrick(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  row: number,
): void {
  const style = brickStyle(brickPoints(row));
  rect(ctx, x, y, w, h, style.base);
  bevel(ctx, x, y, w, h, style.light, style.dark);
}

/** 28×4（加长时 42×4）的挡板，两端有金色端帽。 */
export function drawPaddle(ctx: CanvasRenderingContext2D, x: number, y: number, w: number): void {
  rect(ctx, x, y + 1, w, 2, P.cream);
  rect(ctx, x + 1, y, w - 2, 1, P.white);
  rect(ctx, x, y + 3, w, 1, P.lineHi);
  rect(ctx, x, y + 1, 2, 2, P.gold);
  rect(ctx, x + w - 2, y + 1, 2, 2, P.gold);
}

/** 3×3 像素球，中心一点高光。 */
export function drawBall(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  const px = Math.round(x);
  const py = Math.round(y);
  rect(ctx, px - 1, py - 1, 3, 3, P.cream);
  rect(ctx, px, py, 1, 1, P.white);
}

const POWERUP_COLORS: Record<PowerUpKind, string> = {
  wide: P.mint,
  multi: P.lav,
  life: P.red,
};

/** 7×7 图标：加长挡板 / 三球 / 加命。 */
const POWERUP_ICONS: Record<PowerUpKind, string[]> = {
  wide: ["00000", "11111", "11111", "11111", "00000"],
  multi: ["00100", "00100", "11011", "11011", "00000"],
  life: ["01010", "11111", "11111", "01110", "00100"],
};

export function drawPowerUp(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  kind: PowerUpKind,
): void {
  const color = POWERUP_COLORS[kind];
  rect(ctx, x, y, POWERUP_SIZE, POWERUP_SIZE, P.void);
  strokeRect(ctx, x, y, POWERUP_SIZE, POWERUP_SIZE, color);

  const icon = POWERUP_ICONS[kind];
  for (let row = 0; row < 5; row += 1) {
    const line = icon[row] ?? "";
    for (let col = 0; col < 5; col += 1) {
      if (line[col] === "1") rect(ctx, x + 1 + col, y + 1 + row, 1, 1, color);
    }
  }
}
