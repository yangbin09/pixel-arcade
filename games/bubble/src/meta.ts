import { P, sparkle, wave, type GameMeta } from "@arcade/core";

import { drawBubble, drawMiniCannon, drawThumbFrame } from "./art";
import { FIELD_H, FIELD_W } from "./logic";

/**
 * 缩略图里的一小片蜂窝：3 行、颜色错开，故意做出「同色三连」的形状。
 * 行 0 是 6 列（偶数行多一点），行 1 是 5 列，行 2 只有 3 列——
 * 奇数行按逻辑网格的规则少一列，缩略图也照这个来。
 */
const THUMB_ROWS: readonly (readonly number[])[] = [
  [0, 1, 1, 2, 3, 0],
  [2, 2, 1, 1, 3],
  [3, 0, 2],
];

/** 首页缩略图：80×50 逻辑像素，和游戏画面共用 art.ts 的泡泡与炮台。 */
function drawThumb(ctx: CanvasRenderingContext2D, w: number, h: number, time: number): void {
  drawThumbFrame(ctx, w, h);

  // 蜂窝用与逻辑网格同一套公式缩小摆放：半径 4、行高 7、奇数行偏移半格。
  const radius = 4;
  const stepX = radius * 2;
  const stepY = 7;
  const widest = 6;
  const originX = Math.round((w - ((widest - 1) * stepX + stepX)) / 2) + radius;
  const originY = 7;

  for (let row = 0; row < THUMB_ROWS.length; row += 1) {
    const line = THUMB_ROWS[row] ?? [];
    for (let col = 0; col < line.length; col += 1) {
      const x = originX + col * stepX + (row % 2) * radius;
      const y = originY + row * stepY;
      drawBubble(ctx, x, y, radius, line[col] ?? 0);
    }
  }

  // 正在飞的那颗：在蜂窝和炮台之间上下浮动。
  const cannonX = 40;
  const bob = Math.round(Math.sin(time * 2.4) * 2);
  const flyingY = 31 + bob;
  drawBubble(ctx, cannonX, flyingY, radius, 1);
  sparkle(ctx, cannonX, flyingY - radius - 2, pulseSize(time), P.gold, P.white);

  // 底部小炮台，颜色和飞行中的那颗一致。
  drawMiniCannon(ctx, cannonX, h - 7, radius, 1);

  if (wave(time, 0.5) > 0.6) sparkle(ctx, w - 9, 9, 1, P.mint, P.white);
}

/** 闪烁星星的半径：随时间在两档之间跳，做出街机的呼吸感。 */
function pulseSize(time: number): number {
  return wave(time, 0.7) > 0.55 ? 2 : 1;
}

export const meta: GameMeta = {
  id: "bubble",
  no: 22,
  title: "泡泡龙",
  tagline: "同色三连，整串掉落",
  howto:
    "左右移动炮台，把泡泡射到蜂窝上。同色泡泡连成 3 颗或更多就整块消除；消除后和顶部断开的泡泡会整串掉下来，每颗都算分。一局 40 发，泡泡压到底线就结束，清空全场有额外奖励。B 键可以换手上的颜色。",
  hint: "拖动 / <kbd>←</kbd> <kbd>→</kbd> 移动 · <kbd>空格</kbd> / <kbd>Enter</kbd> 发弹 · <kbd>X</kbd> 换色 · <kbd>P</kbd> 暂停",
  duration: "2–5 分钟",
  tags: ["同色 ≥3 消除", "断连整串掉落", "弹数有限"],
  size: { w: FIELD_W, h: FIELD_H },
  pad: {
    dpad: "lr",
    a: { action: "action", label: "发弹" },
    b: { action: "secondary", label: "换色" },
  },
  scoreMode: "high",
  spaceAction: "action",
  hud: [
    { key: "score", label: "分数", kind: "number", pad: 5, minChars: 5, tone: "score" },
    { key: "shots", label: "弹数", kind: "number", pad: 2, minChars: 2, tone: "mint" },
    { key: "next", label: "下一颗", kind: "text", minChars: 3, tone: "gold" },
  ],
  drawThumb,
};
