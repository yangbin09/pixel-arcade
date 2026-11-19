/**
 * 月面着陆的像素素材：着陆器（带倾斜）、尾焰、月面地形、星光。
 *
 * 全部用字符画 + 像素原语描述，颜色只从 P 取，
 * 缩略图（meta.drawThumb）和游戏画面共用同一套素材，保证同一套调色板。
 */

import { P, rect } from "@arcade/core";

/** 着陆器素材：11 宽 × 13 高。`#` 机身、`o` 舷窗、`.` 透明。 */
const SHIP_ROWS: readonly string[] = [
  ".....#.....",
  "....###....",
  "....###....",
  "...#####...",
  "...#####...",
  "..##ooo##..",
  "..#######..",
  "..#######..",
  ".#########.",
  ".#########.",
  "#.........#",
  "#.........#",
  "##.......##",
];

/** 飞船素材尺寸（与 logic.ts 的 SHIP_W / SHIP_H 一致）。 */
export const SPRITE_W = 11;
export const SPRITE_H = 13;
/** 倾斜时的旋转轴所在行（机身中段）。 */
const PIVOT_ROW = 6;

/**
 * 画着陆器。
 *
 * 倾斜用**逐行水平剪切**实现，而不是 ctx.rotate：
 * 旋转会让像素边缘抗锯齿发虚，剪切后每一行仍是整数像素，
 * 保持像素画的手感；剪切量取 `-(row - 轴心) * sin(angle)`，
 * 正是小角度旋转的水平位移分量，所以视觉倾角和物理角度一致。
 */
export function drawLander(
  ctx: CanvasRenderingContext2D,
  cx: number,
  bottomY: number,
  angle: number,
  thrusting = false,
  flameFrame = 0,
): void {
  const sin = Math.sin(angle);
  const left = Math.round(cx - SPRITE_W / 2);
  const top = Math.round(bottomY - SPRITE_H);

  if (thrusting) drawFlame(ctx, cx, bottomY, sin, flameFrame);

  for (let row = 0; row < SHIP_ROWS.length; row += 1) {
    const line = SHIP_ROWS[row] as string;
    const shift = Math.round(-(row - PIVOT_ROW) * sin);
    for (let col = 0; col < line.length; col += 1) {
      const pixel = line[col];
      if (pixel === "#") rect(ctx, left + col + shift, top + row, 1, 1, P.cream);
      else if (pixel === "o") rect(ctx, left + col + shift, top + row, 1, 1, P.void);
    }
  }

  // 中段的一条暗金腰线，让机身有层次（同样跟着倾斜走）。
  const bandShift = Math.round(-(9 - PIVOT_ROW) * sin);
  rect(ctx, left + 2 + bandShift, top + 9, 7, 1, P.amber);
}

/** 尾焰：沿飞船正下方（含倾斜分量）喷出的三色火苗。 */
function drawFlame(
  ctx: CanvasRenderingContext2D,
  cx: number,
  bottomY: number,
  sin: number,
  frame: number,
): void {
  const tall = Math.abs(Math.floor(frame)) % 2 === 0;
  const length = tall ? 6 : 4;
  for (let i = 0; i < length; i += 1) {
    const x = Math.round(cx - 1 - sin * (i + 1) * 0.8);
    const y = Math.round(bottomY + 1 + i);
    const wide = i < length - 2 ? 3 : 1;
    rect(ctx, x, y, wide, 1, i < 2 ? P.cream : i < length - 1 ? P.amber : P.orange);
  }
}

/**
 * 星光：位置由下标公式决定（不随帧跳变），只让亮度随时间呼吸。
 * 同一个下标永远是同一颗星，所以缩略图与游戏画面看起来是同一片天空。
 */
export function drawStars(
  ctx: CanvasRenderingContext2D,
  w: number,
  maxY: number,
  time: number,
  count = 42,
): void {
  for (let i = 0; i < count; i += 1) {
    const x = (i * 29 + 11) % w;
    const y = (i * 17 + 5) % Math.max(1, maxY);
    const phase = (i % 7) * 0.9;
    const twinkle = (Math.sin(time * 1.7 + phase) + 1) / 2;
    const color = twinkle > 0.72 ? P.white : i % 3 === 0 ? P.lav : i % 3 === 1 ? P.lineHi : P.line;
    rect(ctx, x, y, twinkle > 0.9 ? 2 : 1, 1, color);
  }
}

export interface TerrainLike {
  pads: readonly { x: number; w: number }[];
  rocks: readonly { x: number; w: number }[];
}

/** 岩石顶部的锯齿高度表（固定模式，避免每帧乱抖）。 */
const JAG = [0, 2, 5, 3, 7, 4, 6, 1, 5, 3, 6, 4, 2, 7, 3, 5];

/** 月面：一条平地 + 锯齿岩石。着陆带保持水平，岩石凸起，一眼可分。 */
export function drawTerrain(
  ctx: CanvasRenderingContext2D,
  terrain: TerrainLike,
  groundY: number,
  w: number,
  h: number,
): void {
  // 地面主体
  rect(ctx, 0, groundY, w, h - groundY, P.panel);
  rect(ctx, 0, groundY, w, 1, P.line);
  rect(ctx, 0, groundY + 3, w, 1, P.void);

  // 岩石：凸起在地面线之上，锯齿上沿 + 高光
  for (const rock of terrain.rocks) {
    const width = Math.round(rock.w);
    for (let i = 0; i < width; i += 1) {
      const x = Math.round(rock.x) + i;
      if (x < 0 || x >= w) continue;
      const height = 3 + ((JAG[i % JAG.length] as number) % 5);
      rect(ctx, x, groundY - height, 1, height + 2, P.purple);
      rect(ctx, x, groundY - height, 1, 1, P.lav);
      if (i % 4 === 1) rect(ctx, x, groundY - height + 1, 1, 1, P.lineHi);
    }
  }

  // 着陆带：水平的停机坪，表面亮一档
  for (const pad of terrain.pads) {
    const x = Math.round(pad.x);
    const width = Math.round(pad.w);
    rect(ctx, x, groundY, width, 2, P.lineHi);
    rect(ctx, x, groundY + 2, width, 1, P.line);
    for (let i = 2; i < width - 2; i += 6) rect(ctx, x + i, groundY + 4, 2, 1, P.line);
  }
}

/** 着陆带两端的指示灯柱（金灯呼吸）。着陆点靠它一眼定位。 */
export function drawPadMarker(
  ctx: CanvasRenderingContext2D,
  pad: { x: number; w: number },
  groundY: number,
  time: number,
): void {
  const blink = (Math.sin(time * 3.4) + 1) / 2 > 0.4;
  for (const px of [Math.round(pad.x), Math.round(pad.x + pad.w) - 1]) {
    rect(ctx, px, groundY - 5, 1, 5, P.lineHi);
    rect(ctx, px, groundY - 6, 1, 1, blink ? P.gold : P.amber);
  }
  const center = Math.round(pad.x + pad.w / 2);
  rect(ctx, center - 1, groundY - 1, 3, 1, blink ? P.gold : P.amber);
}

/** 五格像素箭头，触屏按钮用。 */
const ARROW_LEFT: readonly string[] = ["..#..", ".##..", "#####", ".##..", "..#.."];
const ARROW_RIGHT: readonly string[] = ["..#..", "..##.", "#####", "..##.", "..#.."];
const ARROW_UP: readonly string[] = ["..#..", ".###.", "#####", "..#..", "..#.."];

export type ArrowDir = "left" | "right" | "up";

export function drawArrow(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  dir: ArrowDir,
  color: string,
): void {
  const rows = dir === "left" ? ARROW_LEFT : dir === "right" ? ARROW_RIGHT : ARROW_UP;
  for (let row = 0; row < rows.length; row += 1) {
    const line = rows[row] as string;
    for (let col = 0; col < line.length; col += 1) {
      if (line[col] === "#") rect(ctx, x + col, y + row, 1, 1, color);
    }
  }
}
