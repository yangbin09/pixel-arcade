import { P, drawPixelText, measurePixelText, rect, sparkle, wave, type GameMeta } from "@arcade/core";

import { drawMiniBall, drawMiniHoop, drawMiniSparkle } from "./art";

/**
 * 首页缩略图：80×50 逻辑像素。
 * 一位投篮者的剪影 + 篮筐 + 一道虚线弧，和游戏画面共用 art.ts 的素材。
 */
function drawThumb(ctx: CanvasRenderingContext2D, w: number, h: number, time: number): void {
  rect(ctx, 0, 0, w, h, P.night);

  // 背景：上暗下亮 + 斜向扫描线。
  rect(ctx, 0, 0, w, 20, P.void);
  ctx.globalAlpha = 0.5;
  for (let y = 0; y < h; y += 3) rect(ctx, 0, y, w, 1, P.panel);
  ctx.globalAlpha = 1;

  // 固定星尘。
  for (let i = 0; i < 14; i += 1) {
    const x = (i * 37 + 5) % w;
    const y = (i * 13 + 3) % 30;
    rect(ctx, x, y, 1, 1, i % 4 === 0 ? P.cream : i % 3 === 0 ? P.lav : P.line);
  }

  // 地面。
  const floorY = h - 9;
  rect(ctx, 0, floorY, w, h - floorY, P.dirtDeep);
  rect(ctx, 0, floorY, w, 1, P.dirtHi);

  const hoopX = 52;
  const hoopY = 17;
  drawMiniHoop(ctx, hoopX, hoopY);

  // 球架。
  rect(ctx, 8, floorY - 3, 9, 3, P.dirtDeep);
  rect(ctx, 8, floorY - 3, 9, 1, P.dirtHi);

  // 球沿弧线飞：用一个简化的抛物线循环，时间驱动。
  const cycle = (time * 0.55) % 1;
  const startX = 14;
  const startY = floorY - 5;
  const endX = hoopX + 10;
  const endY = hoopY - 1;
  const bx = startX + (endX - startX) * cycle;
  // 抛物线：t=0/1 时在端点，中间拱起。
  const arcLift = 26;
  const by = startY + (endY - startY) * cycle - Math.sin(cycle * Math.PI) * arcLift;

  // 轨迹虚点（已经飞过的部分）。
  for (let i = 0; i < 10; i += 1) {
    const t = (i / 10) * cycle;
    if (t <= 0) continue;
    const px = startX + (endX - startX) * t;
    const py = startY + (endY - startY) * t - Math.sin(t * Math.PI) * arcLift;
    rect(ctx, Math.round(px), Math.round(py), 1, 1, P.purple);
  }

  const hot = cycle > 0.72;
  drawMiniBall(ctx, bx, by, hot);

  // 网的闪光 + 两处星芒。
  const flash = wave(time, 0.6);
  if (cycle > 0.8) {
    ctx.globalAlpha = Math.min(1, (cycle - 0.8) * 5);
    rect(ctx, hoopX + 2, hoopY + 6, 14, 1, P.gold);
    ctx.globalAlpha = 1;
  }
  drawMiniSparkle(ctx, hoopX - 6, hoopY - 5, flash > 0.6);
  sparkle(ctx, w - 7, h - 12, 1, P.amber, P.cream);

  // 缩略图右下角的「+15」，和 tag「空心 +15」呼应。
  const label = "+15";
  const labelW = measurePixelText(label, 1);
  ctx.globalAlpha = 0.55 + 0.45 * flash;
  drawPixelText(ctx, label, w - labelW - 3, h - 19, 1, P.gold, P.void);
  ctx.globalAlpha = 1;

  // 四角折线，和机台屏幕呼应。
  for (const [cx, cy, sx, sy] of [
    [2, 2, 1, 1],
    [w - 3, 2, -1, 1],
    [2, h - 3, 1, -1],
    [w - 3, h - 3, -1, -1],
  ] as const) {
    rect(ctx, cx, cy, 4 * sx, 1, P.lineHi);
    rect(ctx, cx, cy, 1, 4 * sy, P.lineHi);
  }
}

export const meta: GameMeta = {
  id: "hoop",
  no: 16,
  title: "像素投篮",
  tagline: "蓄力出手，连中会冒火",
  howto:
    "按住 A 蓄力，松手出手；力度条会 0→1→0 来回摆，停在金色甜区才进。抛射角固定 62 度，力度决定弧线的远近。空心入网 +15 并累积连中，擦筐进 +10 不算连中，不进连中清零。一轮十球，六十秒到或球用完即结算。",
  hint: "按住 <kbd>空格</kbd> / <kbd>Enter</kbd> 或点按画面蓄力 · 松手出手 · <kbd>P</kbd> 暂停",
  duration: "60 秒",
  tags: ["空心 +15", "连中 ×2", "十球一轮"],
  size: { w: 168, h: 210 },
  scoreMode: "high",
  spaceAction: "action",
  pad: {
    a: { action: "action", label: "出手" },
  },
  hud: [
    { key: "score", label: "分数", kind: "number", pad: 5, minChars: 5, tone: "score" },
    { key: "shots", label: "剩余球", kind: "number", pad: 2, minChars: 2, tone: "red" },
    { key: "combo", label: "连中", kind: "number", pad: 2, minChars: 2, tone: "gold" },
  ],
  drawThumb,
};
