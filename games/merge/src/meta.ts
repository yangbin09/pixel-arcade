import { P, rect, sparkle, strokeRect, wave, type GameMeta } from "@arcade/core";
import { drawTile } from "./art";

/** 缩略图里的 16 个格子：0 为空格，最后一块是金色 2048。 */
const THUMB_TILES = [
  2, 4, 0, 8,
  0, 16, 32, 0,
  0, 64, 128, 2,
  4, 0, 256, 2048,
];

/** 左右各一个像素箭头，暗示「滑动」。 */
function drawChevron(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  direction: -1 | 1,
): void {
  for (let i = 0; i < 3; i += 1) {
    const dy = y + i;
    const px = x + (direction < 0 ? 2 - i : i);
    rect(ctx, px, dy, 1, 1, P.purple);
    rect(ctx, px, y + (4 - i), 1, 1, P.purple);
  }
}

/** 首页缩略图：80×50 逻辑像素。 */
function drawThumb(ctx: CanvasRenderingContext2D, w: number, h: number, time: number): void {
  rect(ctx, 0, 0, w, h, P.night);
  rect(ctx, 0, 0, w, 1, P.line);
  rect(ctx, 0, h - 1, w, 1, P.line);

  const cell = 9;
  const gap = 2;
  const board = cell * 4 + gap * 3; // 42
  const ox = Math.round((w - board) / 2);
  const oy = Math.round((h - board) / 2);

  rect(ctx, ox - 2, oy - 2, board + 4, board + 4, P.panel);
  strokeRect(ctx, ox - 2, oy - 2, board + 4, board + 4, P.line);

  const pulse = wave(time, 0.55) > 0.55 ? 1 : 0;

  for (let i = 0; i < THUMB_TILES.length; i += 1) {
    const col = i % 4;
    const row = Math.floor(i / 4);
    const value = THUMB_TILES[i] ?? 0;
    const x = ox + col * (cell + gap);
    const y = oy + row * (cell + gap);

    if (value === 0) {
      rect(ctx, x, y, cell, cell, P.night);
      continue;
    }

    drawTile(ctx, x, y, cell, value, {
      grow: value === 2048 ? pulse : 0,
      showText: false,
    });
  }

  drawChevron(ctx, 5, 22, -1);
  drawChevron(ctx, 72, 22, 1);

  sparkle(ctx, 71, 8, 1, P.gold, P.white);
  sparkle(ctx, 10, 42, 1, P.amber, P.cream);
  if (pulse > 0) sparkle(ctx, 66, 41, 2, P.gold, P.white);
}

export const meta: GameMeta = {
  id: "merge",
  no: 6,
  title: "2048",
  tagline: "滑到 2048，别把格子堵死",
  howto:
    "滑动或方向键移动全部方块，相同数字相撞会合并，得分就是合并出的数值。每走一步都会冒出一个新块，棋盘塞满且无法合并就结束。按 X 可以撤销一步。",
  hint: "滑动 / <kbd>方向键</kbd> / <kbd>WASD</kbd> 移动 · <kbd>X</kbd> 撤销一步 · <kbd>空格</kbd> 暂停",
  duration: "3–10 分钟",
  tags: ["合并得分", "一步一存档", "无路可走结束"],
  size: { w: 168, h: 168 },
  pad: {
    dpad: "four",
    b: { action: "secondary", label: "撤销" },
  },
  scoreMode: "high",
  countdown: false,
  hud: [
    { key: "score", label: "分数", kind: "number", pad: 5, minChars: 5, tone: "score" },
    { key: "moves", label: "步数", kind: "number", pad: 4, minChars: 4, tone: "time" },
    { key: "bestTile", label: "最大块", kind: "number", pad: 4, minChars: 4, tone: "combo" },
  ],
  drawThumb,
};
