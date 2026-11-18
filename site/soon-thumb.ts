import { P, mulberry32, rect } from "@arcade/core";

/**
 * 「敬请期待」机位的缩略图：半张对称小怪物，每次长得都不一样。
 * 从旧 home.js 的 drawSoon 原样搬过来，逻辑与配色未改。
 */
export function drawSoonThumb(ctx: CanvasRenderingContext2D, w: number, h: number, seed: number): void {
  const rng = mulberry32(seed * 7919 + 13);
  const centerX = Math.round(w / 2);
  const baseY = 16;

  rect(ctx, 0, 0, w, h, P.night);

  for (let y = 4; y < h; y += 6) {
    for (let x = 4; x < w; x += 6) {
      rect(ctx, x, y, 1, 1, P.panel2);
    }
  }

  for (let s = 0; s < 12; s += 1) {
    const sx = 2 + Math.floor(rng() * (w - 4));
    const sy = 2 + Math.floor(rng() * (h - 4));
    rect(ctx, sx, sy, 1, 1, rng() < 0.4 ? P.lineHi : P.purple);
  }

  const half: number[][] = [];
  for (let row = 0; row < 7; row += 1) {
    const line: number[] = [];
    for (let col = 0; col < 5; col += 1) line.push(rng() < 0.48 ? 1 : 0);
    half.push(line);
  }
  half[0]![0] = 1;
  half[1]![0] = 1;
  half[1]![1] = 1;
  half[2]![0] = 1;
  half[5]![2] = 1;
  half[6]![1] = 1;
  half[6]![2] = 1;
  half[2]![2] = 1;
  half[2]![3] = 1;

  const bodyColor = seed % 3 === 0 ? P.purple : P.lav;
  const shadeColor = seed % 3 === 0 ? P.lineHi : P.purple;
  const unit = 3;
  const baseX = centerX - 14;

  const eachBlock = (callback: (x: number, y: number, r: number, c: number) => void): void => {
    for (let r = 0; r < 7; r += 1) {
      for (let c = 0; c < 5; c += 1) {
        if (!half[r]![c]) continue;
        callback(baseX + (4 - c) * unit, baseY + r * unit, r, c);
        if (c > 0) callback(baseX + (4 + c) * unit, baseY + r * unit, r, c);
      }
    }
  };

  eachBlock((x, y) => {
    rect(ctx, x + 1, y + 2, unit, unit, P.void);
  });

  eachBlock((x, y, r, c) => {
    rect(ctx, x, y, unit, unit, bodyColor);
    if (r < 2 || (r === 2 && c === 1)) rect(ctx, x, y, unit - 1, 1, shadeColor);
  });

  const eyeColor = seed % 2 === 0 ? P.amber : P.mint;
  rect(ctx, centerX - 8, baseY + 6, unit, unit, P.void);
  rect(ctx, centerX + 5, baseY + 6, unit, unit, P.void);
  rect(ctx, centerX - 7, baseY + 6, unit - 1, unit - 1, eyeColor);
  rect(ctx, centerX + 6, baseY + 6, unit - 1, unit - 1, eyeColor);
  rect(ctx, centerX - 7, baseY + 6, 1, 1, P.white);
  rect(ctx, centerX + 6, baseY + 6, 1, 1, P.white);

  if (seed % 3 !== 1) {
    rect(ctx, centerX - 10, baseY - 6, 1, 6, shadeColor);
    rect(ctx, centerX + 9, baseY - 6, 1, 6, shadeColor);
    rect(ctx, centerX - 11, baseY - 7, 3, 3, bodyColor);
    rect(ctx, centerX + 9, baseY - 7, 3, 3, bodyColor);
  }

  const borderColor = P.line;
  rect(ctx, 0, 0, w, 1, borderColor);
  rect(ctx, 0, h - 1, w, 1, borderColor);
  rect(ctx, 0, 0, 1, h, borderColor);
  rect(ctx, w - 1, 0, 1, h, borderColor);
}
