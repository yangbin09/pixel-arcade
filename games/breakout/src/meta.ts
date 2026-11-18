import { P, rect, sparkle, wave, type GameMeta } from "@arcade/core";

import { FIELD_H, FIELD_W } from "./logic";

/** 首页缩略图：80×50 逻辑像素，一面砖墙、一块挡板和弹跳的球。 */
function drawThumb(ctx: CanvasRenderingContext2D, w: number, h: number, time: number): void {
  rect(ctx, 0, 0, w, h, P.night);
  rect(ctx, 0, 0, w, 1, P.line);
  rect(ctx, 0, h - 1, w, 1, P.line);

  // 顶部铆钉
  for (let i = 0; i < 7; i += 1) rect(ctx, 6 + i * 10, 5, 1, 1, P.lineHi);

  // 6×4 的小砖墙
  const brickW = 9;
  const brickH = 4;
  const gap = 1;
  const wallW = 6 * brickW + 5 * gap;
  const ox = Math.round((w - wallW) / 2);

  for (let row = 0; row < 4; row += 1) {
    const base = row === 0 ? P.red : row < 3 ? P.amber : P.mint;
    const light = row === 0 ? P.pink : row < 3 ? P.gold : P.cream;

    for (let col = 0; col < 6; col += 1) {
      const x = ox + col * (brickW + gap);
      const y = 10 + row * 5;
      rect(ctx, x, y, brickW, brickH, base);
      rect(ctx, x, y, brickW, 1, light);
    }
  }

  // 挡板
  rect(ctx, 30, 43, 20, 2, P.cream);
  rect(ctx, 31, 42, 18, 1, P.white);
  rect(ctx, 30, 45, 20, 1, P.lineHi);

  // 球在砖墙和挡板之间来回弹
  const bx = Math.round(38 + Math.sin(time * 2.2) * 10);
  const by = Math.round(37 - Math.abs(Math.sin(time * 2.6)) * 6);
  rect(ctx, bx - 1, by - 1, 3, 3, P.cream);
  rect(ctx, bx, by, 1, 1, P.white);

  sparkle(ctx, 68, 9, wave(time, 0.7) > 0.6 ? 2 : 1, P.gold, P.white);
  sparkle(ctx, 9, 34, 1, P.amber, P.cream);
}

export const meta: GameMeta = {
  id: "breakout",
  no: 3,
  title: "打砖块",
  tagline: "三块砖一条命，撑到第三关",
  howto:
    "左右移动挡板把球弹回去，打碎全部砖块就能过关。没接住球会掉一条命，三条命用完本局结束。砖块有几率掉落道具：加长挡板、分裂三球或增加一条命，用挡板接住即可生效。",
  hint:
    "拖动 / <kbd>←</kbd> <kbd>→</kbd> 移动 · <kbd>空格</kbd> / <kbd>Enter</kbd> 发射 · <kbd>P</kbd> 暂停",
  duration: "2–4 分钟",
  tags: ["砖块 10/20/30", "掉落道具", "3 条命"],
  size: { w: FIELD_W, h: FIELD_H },
  scoreMode: "high",
  spaceAction: "action",
  hud: [
    { key: "score", label: "分数", kind: "number", pad: 5, minChars: 5, tone: "score" },
    { key: "lives", label: "生命", kind: "number", pad: 2, minChars: 2, tone: "red" },
    { key: "level", label: "关卡", kind: "number", pad: 2, minChars: 2, tone: "combo" },
  ],
  drawThumb,
};
