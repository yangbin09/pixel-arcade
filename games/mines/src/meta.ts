import { P, rect, sparkle, strokeRect, wave, type GameMeta } from "@arcade/core";

import { drawCovered, drawFlag, drawMine, drawNumber, drawOpen } from "./art";

type MiniKind = "cover" | "flag" | "open" | "mine";

interface MiniCell {
  kind: MiniKind;
  count?: number;
}

/** 缩略图里的 3×3 小棋局：一局刚踩到雷的定格。 */
const MINI: readonly MiniCell[] = [
  { kind: "cover" },
  { kind: "flag" },
  { kind: "open", count: 1 },
  { kind: "open", count: 0 },
  { kind: "cover" },
  { kind: "open", count: 2 },
  { kind: "mine" },
  { kind: "open", count: 1 },
  { kind: "cover" },
];

/** 首页缩略图：80×50 逻辑像素，与游戏画面共用 art.ts 的像素素材。 */
function drawThumb(ctx: CanvasRenderingContext2D, w: number, h: number, time: number): void {
  rect(ctx, 0, 0, w, h, P.night);
  rect(ctx, 0, 0, w, 1, P.line);
  rect(ctx, 0, h - 1, w, 1, P.line);

  const cell = 11;
  const gap = 1;
  const board = 3 * cell + 2 * gap;
  const ox = Math.round((w - board) / 2);
  const oy = Math.round((h - board) / 2);

  rect(ctx, ox - 2, oy - 2, board + 4, board + 4, P.void);
  strokeRect(ctx, ox - 2, oy - 2, board + 4, board + 4, P.line);

  for (let i = 0; i < MINI.length; i += 1) {
    const item = MINI[i];
    const x = ox + (i % 3) * (cell + gap);
    const y = oy + Math.floor(i / 3) * (cell + gap);

    if (item.kind === "mine") {
      rect(ctx, x, y, cell, cell, P.redDeep);
      drawMine(ctx, x + Math.floor(cell / 2), y + Math.floor(cell / 2), 2, P.void, P.white);
      continue;
    }

    if (item.kind === "open") {
      drawOpen(ctx, x, y, cell);
      drawNumber(ctx, x, y, cell, item.count ?? 0, 1);
      continue;
    }

    drawCovered(ctx, x, y, cell);
    if (item.kind === "flag") drawFlag(ctx, x, y, cell);
  }

  const pulse = wave(time, 0.6) > 0.55;
  sparkle(ctx, ox + board - 2, oy - 4, pulse ? 2 : 1, P.gold, P.white);
}

export const meta: GameMeta = {
  id: "mines",
  no: 10,
  title: "像素扫雷",
  tagline: "8×8 十颗雷，第一下不会炸",
  howto:
    "轻点翻开格子，长按 350 毫秒或按 X 插旗；第一下点到的格子一定安全。数字是周围八格的雷数，翻开全部 54 个安全格就通关，踩到雷立即结束。",
  hint: "轻点翻开 · 长按 / <kbd>X</kbd> 插旗 · <kbd>空格</kbd> 暂停",
  duration: "1–5 分钟",
  tags: ["长按插旗", "首点安全", "清完即通关"],
  size: { w: 168, h: 168 },
  pad: {
    dpad: "four",
    a: { action: "primary", label: "翻开" },
    b: { action: "secondary", label: "插旗" },
  },
  scoreMode: "low",
  scoreLabel: "用时（秒）",
  bestLabel: "最快纪录",
  countdown: false,
  hud: [
    { key: "time", label: "用时", kind: "time", minChars: 3, tone: "time" },
    { key: "flags", label: "雷数", kind: "number", pad: 2, minChars: 2, tone: "red" },
    { key: "opened", label: "已开格", kind: "number", pad: 3, minChars: 3, tone: "mint" },
  ],
  drawThumb,
};
