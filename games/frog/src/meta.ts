import { P, rect, sparkle, wave, type GameMeta } from "@arcade/core";

import { drawCar, drawFrog, drawLog, paintWaterStrip } from "./art";

/**
 * 首页缩略图：80×50 逻辑像素。
 * 从下往上压扁的一小段河段：起点草 → 车道 → 河 → 对岸，
 * 青蛙正踩在漂动的木头上（和游戏里同一条「被木头带着走」的规则）。
 */
function drawThumb(ctx: CanvasRenderingContext2D, w: number, h: number, t: number): void {
  rect(ctx, 0, 0, w, h, P.void);

  // 行带（自上而下）：对岸 8 / 河 10 / 河 10 / 车 10 / 起点 12
  const goalTop = 0;
  const river1 = 8;
  const river2 = 18;
  const roadTop = 28;
  const startTop = 38;

  // 对岸草坪 + 荷叶
  rect(ctx, 0, goalTop, w, river1, P.grassDeep);
  rect(ctx, 0, goalTop, w, 2, P.grassHi);
  for (let x = 2; x < w; x += 15) {
    rect(ctx, x, 3, 9, 3, P.grass);
    rect(ctx, x + 2, 3, 5, 1, P.mint);
  }

  // 两段河面
  paintWaterStrip(ctx, 0, river1, w, 10);
  paintWaterStrip(ctx, 0, river2, w, 10);

  // 车道
  rect(ctx, 0, roadTop, w, startTop - roadTop, P.panel);
  rect(ctx, 0, roadTop, w, 1, P.hole);
  rect(ctx, 0, startTop - 1, w, 1, P.hole);
  for (let x = 1; x < w; x += 14) rect(ctx, x, roadTop + 5, 7, 1, P.lineHi);

  // 起点草
  rect(ctx, 0, startTop, w, h - startTop, P.grassDeep);
  rect(ctx, 0, startTop, w, 1, P.grass);
  for (let x = 2; x < w; x += 7) rect(ctx, x, startTop + 3, 3, 2, P.grass);

  // 两根木头，方向相反地漂
  const drift = Math.round(wave(t, 0.13) * 9);
  const logLow = 3 + drift;
  const logHigh = w - 40 - drift;
  drawLog(ctx, logLow, river1 + 1, 30, 8);
  drawLog(ctx, logHigh, river2 + 1, 32, 8);

  // 车道里两辆对向的车
  const carX = Math.round(((t * 16) % (w + 20)) - 10);
  drawCar(ctx, carX, roadTop + 2, 16, 7, 0, 1);
  drawCar(ctx, w - carX - 16, roadTop + 2, 16, 7, 1, -1);

  // 青蛙踩在上面那根木头上，随木头横移；偶尔起跳
  const hopping = Math.sin(t * 3.3) > 0.62;
  drawFrog(ctx, Math.round(logHigh + 16), river2 + 4 + (hopping ? -2 : 0), {
    airborne: hopping,
    time: t,
  });

  // 高光 + 外框
  if (Math.sin(t * 2.1) > 0.15) sparkle(ctx, 9, 21, 1, P.gold, P.white);
  rect(ctx, 0, 0, w, 1, P.line);
  rect(ctx, 0, h - 1, w, 1, P.line);
  rect(ctx, 0, 0, 1, h, P.line);
  rect(ctx, w - 1, 0, 1, h, P.line);
}

export const meta: GameMeta = {
  id: "frog",
  no: 21,
  title: "青蛙过河",
  tagline: "跳过车道，踩准浮木",
  howto:
    "方向键或轻点画面，让青蛙一格一格地跳：躲开五个车道上的汽车，跳进河里要踩住漂来的浮木，木头会把你带着走，踩空或被带出河面都会落水。每到达一个新的最远行 +10 分，跳到对岸立刻通关并额外 +50 分，三条命用完就结束。",
  hint: "方向键 / WASD 跳一格 · 轻点画面朝那个方向跳 · <kbd>空格</kbd> 暂停",
  duration: "1–3 分钟",
  tags: ["每前进一行 +10", "三条命", "落水即扣命"],
  size: { w: 168, h: 210 },
  pad: {
    dpad: "four",
    a: { action: "action", label: "跳" },
  },
  scoreMode: "high",
  hud: [
    { key: "score", label: "分数", kind: "number", pad: 5, minChars: 5, tone: "score" },
    { key: "row", label: "最远行", kind: "number", pad: 2, minChars: 2, tone: "mint" },
    { key: "lives", label: "生命", kind: "number", pad: 1, minChars: 1, tone: "red" },
  ],
  drawThumb,
};
