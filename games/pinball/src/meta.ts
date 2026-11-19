import { P, rect, sparkle, wave, type GameMeta } from "@arcade/core";

import { drawBall, drawBumper, drawFlipper } from "./art";

/** 首页缩略图：80×50 的一台上半身特写 —— 两个缓冲器、一颗在弹的球、两块挡板。 */
function drawThumb(ctx: CanvasRenderingContext2D, w: number, h: number, time: number): void {
  rect(ctx, 0, 0, w, h, P.night);
  rect(ctx, 0, 0, w, 1, P.line);
  rect(ctx, 0, h - 1, w, 1, P.line);

  // 台面：内缩一圈的深色井，加顶部导轨
  rect(ctx, 4, 3, w - 8, h - 6, P.void);
  rect(ctx, 4, 11, w - 8, 1, P.line);

  // 两个缓冲器（对应真实坐标的比例位置）
  const pulse = wave(time, 0.75);
  drawBumper(ctx, 24, 20, 6, 0.15 + pulse * 0.5);
  drawBumper(ctx, 56, 20, 6, 0.75 - pulse * 0.5);

  // 中间的靶标条
  rect(ctx, 6, 30, 2, 6, P.panel2);
  rect(ctx, w - 8, 30, 2, 6, P.panel2);

  // 两块挡板
  drawFlipper(ctx, { x0: 15, y0: 42, x1: 31, y1: 39 }, false);
  drawFlipper(ctx, { x0: 65, y0: 42, x1: 49, y1: 39 }, false);

  // 球在缓冲器之间来回
  const bx = 40 + Math.sin(time * 2.1) * 13;
  const by = 30 + Math.sin(time * 3.3) * 5;
  drawBall(ctx, bx, by, 2);

  // 掉球线
  rect(ctx, 4, h - 4, w - 8, 1, P.redDeep);

  sparkle(ctx, 70, 6, wave(time, 0.6) > 0.6 ? 2 : 1, P.gold, P.white);
}

export const meta: GameMeta = {
  id: "pinball",
  no: 29,
  title: "像素弹珠台",
  tagline: "守住底门，打满缓冲器",
  howto:
    "按 A / 左方向键抬左挡板，按 B / 右方向键抬右挡板，把从顶部落下的球弹回去。撞击缓冲器得 100 分，900 毫秒内连续撞击依次变成 200 / 400 / 800。两侧各有 3 个靶标，打亮全部 6 个额外加 1000 分并重置。球掉出底部扣一颗球，3 颗球用完本局结束。",
  hint:
    "轻点屏幕左右两侧抬板 · <kbd>←</kbd> / <kbd>Z</kbd> 左板 · <kbd>→</kbd> / <kbd>X</kbd> 右板 · <kbd>空格</kbd> 暂停",
  duration: "1–3 分钟",
  tags: ["缓冲器 +100", "连击加倍率", "掉球扣命"],
  size: { w: 168, h: 210 },
  pad: {
    dpad: "lr",
    a: { action: "primary", label: "左板" },
    b: { action: "secondary", label: "右板" },
  },
  scoreMode: "high",
  hud: [
    { key: "score", label: "分数", kind: "number", pad: 5, minChars: 5, tone: "score" },
    { key: "balls", label: "球", kind: "number", pad: 1, minChars: 1, tone: "red" },
    { key: "mult", label: "倍率", kind: "text", minChars: 2, tone: "gold" },
  ],
  drawThumb,
};
