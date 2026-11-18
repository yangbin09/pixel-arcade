import {
  P,
  ellipseHalf,
  fillEllipse,
  rect,
  sparkle,
} from "@arcade/core";

/**
 * 打地鼠专属像素素材（从旧 core.js 原样迁出）。
 * 这些不是通用能力，所以不再放进引擎里。
 */

const MOLE_PROFILE = [
  4, 7, 9, 11, 12, 13, 14, 14, 14, 14, 14, 14, 13, 13, 13, 12,
  12, 11, 11, 10, 10, 9, 9, 8, 8, 7, 6, 5, 4, 3,
];

export function paintGrass(ctx: CanvasRenderingContext2D, w: number, h: number, seed = 7): void {
  rect(ctx, 0, 0, w, h, P.grassDeep);
  let s = seed >>> 0;
  const rng = (): number => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  for (let y = 2; y < h; y += 4) {
    const offset = y % 8 === 2 ? 1 : 3;
    for (let x = offset; x < w; x += 6) {
      if (rng() < 0.52) rect(ctx, x, y, 1, 1, P.grass);
    }
  }

  const count = Math.round((w * h) / 190);
  for (let i = 0; i < count; i += 1) {
    const x = 2 + Math.floor(rng() * (w - 4));
    const y = 2 + Math.floor(rng() * (h - 4));
    const color = rng() < 0.24 ? P.grassHi : P.grass;
    rect(ctx, x, y, 1, 2, color);
    rect(ctx, x - 1, y + 1, 1, 1, color);
    rect(ctx, x + 1, y + 2, 1, 1, color);
  }

  rect(ctx, 2, 2, 2, 2, P.lineHi);
  rect(ctx, w - 4, 2, 2, 2, P.lineHi);
  rect(ctx, 2, h - 4, 2, 2, P.lineHi);
  rect(ctx, w - 4, h - 4, 2, 2, P.lineHi);
}

export function drawHoleBack(ctx: CanvasRenderingContext2D, cx: number, cy: number): void {
  cx = Math.round(cx);
  cy = Math.round(cy);

  fillEllipse(ctx, cx, cy + 3, 24, 10, P.dirtDeep);
  fillEllipse(ctx, cx, cy + 1, 22, 9, P.dirt);

  for (let dy = -9; dy <= -6; dy += 1) {
    const half = ellipseHalf(22, 9, dy);
    if (half > 2) rect(ctx, cx - half + 2, cy + 1 + dy, half * 2 - 4, 1, P.dirtHi);
  }

  fillEllipse(ctx, cx, cy + 4, 18, 8, P.dirtDeep);
  fillEllipse(ctx, cx, cy + 4, 16, 6, P.hole);

  for (let dy = -6; dy <= -4; dy += 1) {
    const half = ellipseHalf(16, 6, dy);
    if (half > 1) rect(ctx, cx - half + 1, cy + 4 + dy, half * 2 - 2, 1, P.dirtHi);
  }

  rect(ctx, cx - 19, cy + 4, 2, 1, P.dirt);
  rect(ctx, cx + 16, cy + 7, 3, 1, P.dirtHi);
  rect(ctx, cx - 15, cy - 3, 2, 1, P.dirtHi);

  const variant = ((cx * 13 + cy * 7) >> 2) % 3;
  if (variant !== 1) {
    rect(ctx, cx - 23, cy + 5, 1, 3, P.grassHi);
    rect(ctx, cx - 22, cy + 6, 1, 1, P.grass);
  }
  if (variant !== 2) {
    rect(ctx, cx + 22, cy + 5, 1, 3, P.grassHi);
    rect(ctx, cx + 21, cy + 7, 1, 1, P.grass);
  }
}

export function drawHoleFront(ctx: CanvasRenderingContext2D, cx: number, cy: number): void {
  cx = Math.round(cx);
  cy = Math.round(cy);

  for (let dy = 4; dy <= 7; dy += 1) {
    const half = ellipseHalf(18, 8, dy);
    if (half <= 0) continue;
    rect(ctx, cx - half, cy + 4 + dy, half * 2, 1, P.dirt);
    if (dy === 4) rect(ctx, cx - half + 2, cy + 4 + dy, Math.max(0, half * 2 - 4), 1, P.dirtHi);
  }

  rect(ctx, cx - 14, cy + 10, 3, 1, P.dirtDeep);
  rect(ctx, cx + 11, cy + 9, 2, 1, P.dirtDeep);
}

function drawMoleEar(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  outline: string,
  inner: string,
  light: string,
): void {
  rect(ctx, x, y, 6, 6, outline);
  rect(ctx, x + 1, y + 1, 4, 4, inner);
  rect(ctx, x + 1, y + 1, 2, 1, light);
}

export interface MoleOptions {
  hit?: boolean;
  flash?: boolean;
}

export function drawMole(
  ctx: CanvasRenderingContext2D,
  cx: number,
  top: number,
  kind: "brown" | "gold",
  options: MoleOptions = {},
): void {
  cx = Math.round(cx);
  top = Math.round(top);
  const flash = !!options.flash;
  const gold = kind === "gold";

  let outline: string;
  let body: string;
  let light: string;
  let belly: string;
  let nose: string;
  let earInner: string;

  if (flash) {
    outline = P.amber;
    body = P.white;
    light = P.white;
    belly = P.white;
    nose = P.orange;
    earInner = P.cream;
  } else if (gold) {
    outline = P.dirtDeep;
    body = P.gold;
    light = P.white;
    belly = P.cream;
    nose = P.orange;
    earInner = P.amber;
  } else {
    outline = P.dirtDeep;
    body = P.dirt;
    light = P.dirtHi;
    belly = P.cream;
    nose = P.pink;
    earInner = P.dirtHi;
  }

  drawMoleEar(ctx, cx - 18, top + 5, outline, earInner, light);
  drawMoleEar(ctx, cx + 12, top + 5, outline, earInner, light);

  for (let row = 0; row < MOLE_PROFILE.length; row += 1) {
    const half = MOLE_PROFILE[row]!;
    rect(ctx, cx - half - 1, top + row, half * 2 + 2, 1, outline);
    rect(ctx, cx - half, top + row, half * 2, 1, body);
  }

  rect(ctx, cx - 3, top + 1, 4, 1, light);
  rect(ctx, cx - 2, top + 2, 2, 1, light);
  for (let row = 5; row <= 11; row += 2) {
    const half = MOLE_PROFILE[row]!;
    rect(ctx, cx - half + 2, top + row, 2, 1, light);
  }

  if (!gold) {
    rect(ctx, cx - 1, top - 1, 3, 1, outline);
    rect(ctx, cx, top - 2, 1, 1, body);
  }

  const muzzle = [2, 4, 5, 6, 6, 5];
  for (let i = 0; i < muzzle.length; i += 1) {
    const half = muzzle[i]!;
    rect(ctx, cx - half, top + 16 + i, half * 2, 1, belly);
  }
  rect(ctx, cx - 5, top + 22, 10, 1, P.dirtHi);

  if (options.hit) {
    const ink = flash ? P.orange : P.void;
    rect(ctx, cx - 8, top + 9, 1, 1, ink);
    rect(ctx, cx - 6, top + 10, 3, 1, ink);
    rect(ctx, cx - 5, top + 11, 1, 1, ink);
    rect(ctx, cx + 3, top + 9, 1, 1, ink);
    rect(ctx, cx + 5, top + 10, 3, 1, ink);
    rect(ctx, cx + 8, top + 11, 1, 1, ink);
  } else {
    rect(ctx, cx - 7, top + 9, 3, 3, P.void);
    rect(ctx, cx - 6, top + 9, 1, 1, P.white);
    rect(ctx, cx + 4, top + 9, 3, 3, P.void);
    rect(ctx, cx + 5, top + 9, 1, 1, P.white);
  }

  rect(ctx, cx - 3, top + 16, 6, 1, outline);
  rect(ctx, cx - 2, top + 17, 4, 2, nose);
  rect(ctx, cx - 2, top + 17, 1, 1, P.white);

  rect(ctx, cx - 3, top + 21, 2, 1, outline);
  rect(ctx, cx + 2, top + 21, 2, 1, outline);
  rect(ctx, cx - 1, top + 22, 2, 1, outline);
  rect(ctx, cx - 10, top + 18, 2, 1, outline);
  rect(ctx, cx + 9, top + 18, 2, 1, outline);

  rect(ctx, cx - 15, top + 21, 7, 7, outline);
  rect(ctx, cx - 14, top + 22, 5, 5, light);
  rect(ctx, cx - 13, top + 24, 1, 2, outline);

  rect(ctx, cx + 8, top + 21, 7, 7, outline);
  rect(ctx, cx + 9, top + 22, 5, 5, light);
  rect(ctx, cx + 12, top + 24, 1, 2, outline);

  if (gold) {
    const crownY = top - 4;
    rect(ctx, cx - 6, crownY + 3, 13, 2, outline);
    for (let i = 0; i < 3; i += 1) {
      const x = cx - 6 + i * 5;
      rect(ctx, x, crownY, 2, 4, outline);
      rect(ctx, x, crownY + 1, 2, 2, P.gold);
    }
    rect(ctx, cx - 5, crownY + 2, 11, 2, P.gold);
    rect(ctx, cx - 5, crownY + 2, 3, 1, P.white);
    rect(ctx, cx + 3, crownY + 2, 2, 1, P.amber);
    rect(ctx, cx - 1, crownY + 3, 2, 1, P.pink);
  }
}

export function drawHammer(ctx: CanvasRenderingContext2D, x: number, y: number, strike: boolean): void {
  x = Math.round(x);
  y = Math.round(y);

  const hx = strike ? x - 8 : x + 4;
  const hy = strike ? y - 17 : y - 29;

  const handle = strike
    ? [
        [x + 2, y - 10],
        [x + 5, y - 7],
        [x + 8, y - 4],
        [x + 11, y - 1],
      ]
    : [
        [x + 12, y - 21],
        [x + 9, y - 17],
        [x + 6, y - 13],
        [x + 3, y - 9],
        [x, y - 5],
      ];

  for (const point of handle) {
    const px = point[0]!;
    const py = point[1]!;
    rect(ctx, px - 1, py - 1, 5, 5, P.dirtDeep);
    rect(ctx, px, py, 3, 3, P.dirt);
    rect(ctx, px, py, 1, 2, P.dirtHi);
  }

  rect(ctx, hx - 1, hy - 1, 18, 12, P.dirtDeep);
  rect(ctx, hx, hy, 16, 10, P.cream);
  rect(ctx, hx + 1, hy + 1, 14, 2, P.white);
  rect(ctx, hx, hy + 7, 16, 2, P.amber);
  rect(ctx, hx + 1, hy + 7, 3, 2, P.orange);
  rect(ctx, hx - 1, hy + 2, 2, 5, P.orange);
  rect(ctx, hx + 15, hy + 2, 2, 5, P.orange);
  rect(ctx, hx + 3, hy + 4, 2, 1, P.dirtDeep);
  rect(ctx, hx + 11, hy + 4, 2, 1, P.dirtDeep);

  if (strike) {
    rect(ctx, x - 16, y - 14, 5, 1, P.cream);
    rect(ctx, x - 19, y - 9, 8, 1, P.amber);
    rect(ctx, x - 14, y - 4, 3, 1, P.cream);
  }
}

/** 四角星芒（旧 Art.drawSparkle，白芯）。 */
export function drawSparkle(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  color: string,
): void {
  sparkle(ctx, x, y, size, color, P.white);
}
