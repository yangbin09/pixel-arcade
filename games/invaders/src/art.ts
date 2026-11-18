import { P, rect, type PaletteKey } from "@arcade/core";

/**
 * 像素入侵者专属素材：3 种 11×7 敌机（各 2 帧）与 11×7 玩家飞船。
 *
 * 全部用字符画描述，`#` 是机体、`+` 是高光、`o` 是眼睛；
 * 颜色在绘制时从 P 里取，保证和引擎调色板始终一致。
 */

export type EnemyKind = 0 | 1 | 2;

type SpriteRows = readonly string[];

/** 螃蟹机：方头、两侧钳子。 */
const CRAB_A: SpriteRows = [
  "..+.....+..",
  "...#...#...",
  "..#o###o#..",
  ".##.###.##.",
  "###########",
  "#.#######.#",
  "#.#.....#.#",
];

const CRAB_B: SpriteRows = [
  "..+.....+..",
  "...#...#...",
  "..#o###o#..",
  ".##.###.##.",
  "###########",
  "#.#######.#",
  ".#.#...#.#.",
];

/** 章鱼机：圆头、细腿。 */
const SQUID_A: SpriteRows = [
  "...#####...",
  "..#######..",
  ".#..###..#.",
  "###########",
  "#.#######.#",
  "..#.....#..",
  ".#.......#.",
];

const SQUID_B: SpriteRows = [
  "...#####...",
  "..#######..",
  ".#..###..#.",
  "###########",
  "#.#######.#",
  ".#.......#.",
  "..#.....#..",
];

/** 甲虫机：触角、宽身。 */
const BEETLE_A: SpriteRows = [
  "....#.#....",
  "...#####...",
  "..#######..",
  ".##.###.##.",
  "###########",
  "..##...##..",
  ".##.....##.",
];

const BEETLE_B: SpriteRows = [
  "....#.#....",
  "...#####...",
  "..#######..",
  ".##o###o##.",
  "###########",
  "..##...##..",
  ".##.#.#.##.",
];

const ENEMY_FRAMES: readonly (readonly SpriteRows[])[] = [
  [CRAB_A, CRAB_B],
  [SQUID_A, SQUID_B],
  [BEETLE_A, BEETLE_B],
];

/** 每种敌机的主色 / 高光，颜色键在绘制时才解析。 */
const ENEMY_COLORS: readonly { body: PaletteKey; glint: PaletteKey }[] = [
  { body: "lav", glint: "cream" },
  { body: "mint", glint: "white" },
  { body: "amber", glint: "cream" },
];

export function drawEnemy(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  kind: EnemyKind,
  frame: number,
): void {
  const frames = ENEMY_FRAMES[kind] ?? ENEMY_FRAMES[0]!;
  const rows = frames[Math.abs(Math.floor(frame)) % frames.length] ?? frames[0]!;
  const colors = ENEMY_COLORS[kind] ?? ENEMY_COLORS[0]!;
  const px = Math.round(x);
  const py = Math.round(y);

  for (let row = 0; row < rows.length; row += 1) {
    const line = rows[row]!;
    for (let col = 0; col < line.length; col += 1) {
      const pixel = line[col];
      if (pixel === "#") rect(ctx, px + col, py + row, 1, 1, P[colors.body]);
      else if (pixel === "+") rect(ctx, px + col, py + row, 1, 1, P[colors.glint]);
      else if (pixel === "o") rect(ctx, px + col, py + row, 1, 1, P.void);
    }
  }
}

/** 玩家飞船：机头朝上，底部两簇尾焰交替闪。 */
const SHIP_ROWS: SpriteRows = [
  ".....#.....",
  "....+++....",
  "....###....",
  ".#########.",
  "###########",
  "##.#####.##",
  "#...###...#",
];

export function drawShip(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  flameFrame: number,
): void {
  const px = Math.round(x);
  const py = Math.round(y);
  const tall = Math.abs(Math.floor(flameFrame)) % 2 === 0;

  // 尾焰先画，机身盖住焰根。
  rect(ctx, px + 3, py + SHIP_ROWS.length, 1, tall ? 2 : 1, P.amber);
  rect(ctx, px + 7, py + SHIP_ROWS.length, 1, tall ? 1 : 2, P.amber);
  rect(ctx, px + 4, py + SHIP_ROWS.length, 2, 1, P.orange);
  rect(ctx, px + 6, py + SHIP_ROWS.length, 1, 1, P.orange);

  for (let row = 0; row < SHIP_ROWS.length; row += 1) {
    const line = SHIP_ROWS[row]!;
    for (let col = 0; col < line.length; col += 1) {
      const pixel = line[col];
      if (pixel === "#") rect(ctx, px + col, py + row, 1, 1, P.mint);
      else if (pixel === "+") rect(ctx, px + col, py + row, 1, 1, P.cream);
    }
  }
}
