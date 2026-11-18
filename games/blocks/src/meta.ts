import { P, rect, sparkle, strokeRect, wave, type GameMeta } from "@arcade/core";

import { drawMiniBlock } from "./art";
import type { PieceKind } from "./logic";

/**
 * 缩略图：7×10 的迷你棋盘，底部堆着三种方块，右边一张 NEXT 小卡。
 * 棋盘格 4px，80×50 的构图里刚好放得下。
 */
const THUMB_ROWS = [
  "0000000",
  "00T0000",
  "0TTT000",
  "0000000",
  "0000000",
  "0000000",
  "0SS0000",
  "SSLLZZ0",
  "JJLLLZ0",
  "JJJLLZ0",
] as const;

const THUMB_KINDS: Partial<Record<string, PieceKind>> = {
  T: "T",
  S: "S",
  Z: "Z",
  J: "J",
  L: "L",
};

function drawThumb(ctx: CanvasRenderingContext2D, w: number, h: number, time: number): void {
  rect(ctx, 0, 0, w, h, P.night);
  rect(ctx, 0, 0, w, 1, P.line);
  rect(ctx, 0, h - 1, w, 1, P.line);

  const cell = 4;
  const cols = 7;
  const rows = THUMB_ROWS.length;
  const bx = 23;
  const by = 5;
  const bw = cols * cell;
  const bh = rows * cell;

  rect(ctx, bx - 1, by - 1, bw + 2, bh + 2, P.void);
  strokeRect(ctx, bx - 1, by - 1, bw + 2, bh + 2, P.line);

  ctx.save();
  ctx.globalAlpha = 0.5;
  for (let col = 1; col < cols; col += 1) rect(ctx, bx + col * cell, by, 1, bh, P.panel2);
  for (let row = 1; row < rows; row += 1) rect(ctx, bx, by + row * cell, bw, 1, P.panel2);
  ctx.restore();

  for (let row = 0; row < rows; row += 1) {
    const line = THUMB_ROWS[row];
    for (let col = 0; col < cols; col += 1) {
      const kind = THUMB_KINDS[line[col] ?? "0"];
      if (!kind) continue;
      drawMiniBlock(ctx, bx + col * cell, by + row * cell, cell, kind);
    }
  }

  // 右侧 NEXT 小卡：一条横 I，正好 4 格
  const nx = 58;
  const ny = 7;
  rect(ctx, nx, ny, 16, 16, P.panel);
  strokeRect(ctx, nx, ny, 16, 16, P.lineHi);
  for (let i = 0; i < 4; i += 1) {
    drawMiniBlock(ctx, nx + 2 + i * 3, ny + 6, 3, "I");
  }

  const pulse = wave(time, 0.55) > 0.62;
  sparkle(ctx, 63, 3, pulse ? 2 : 1, P.gold, P.white);
  sparkle(ctx, 12, 44, 1, P.amber, P.cream);
  sparkle(ctx, 74, 33, 1, P.lav, P.cream);
}

export const meta: GameMeta = {
  id: "blocks",
  no: 5,
  title: "俄罗斯方块",
  tagline: "十行一级，堆到顶就结束",
  howto:
    "方块从顶部落下，左右移动、旋转、硬降，填满一整行就会消除。一次消四行最划算，每消十行升一级、下落更快。方块堆到顶就结束。",
  hint: "方向键 / <kbd>WASD</kbd> 移动 · <kbd>↑</kbd> / <kbd>X</kbd> 旋转 · <kbd>↓</kbd> 软降 · <kbd>空格</kbd> 硬降",
  duration: "3–8 分钟",
  tags: ["消行 100/300/500/800", "每 10 行升级", "硬降 +2/格"],
  size: { w: 200, h: 392 },
  scoreMode: "high",
  spaceAction: "action",
  countdown: false,
  hud: [
    { key: "score", label: "分数", kind: "number", pad: 5, minChars: 5, tone: "score" },
    { key: "lines", label: "消行", kind: "number", pad: 3, minChars: 3, tone: "mint" },
    { key: "level", label: "等级", kind: "number", pad: 2, minChars: 2, tone: "combo" },
  ],
  drawThumb,
};
