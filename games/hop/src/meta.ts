import { P, rect, sparkle, wave, type GameMeta } from "@arcade/core";

import { drawBankFlag, drawFrog } from "./art";

/**
 * 首页缩略图：80×50 逻辑像素。
 * 从下往上压缩的一小段河段：起点草 → 车道 → 草 → 河 → 对岸，
 * 主角青蛙正踩在漂动的木头上（和游戏里同一条规则）。
 */
function drawThumb(ctx: CanvasRenderingContext2D, w: number, h: number, time: number): void {
  rect(ctx, 0, 0, w, h, P.void);

  // 行带高度（自上而下）：home 9 / water 9 / water 9 / safe 6 / road 9 / start 8
  const homeTop = 0;
  const water1 = 9;
  const water2 = 18;
  const safeTop = 27;
  const roadTop = 33;
  const startTop = 42;

  // 对岸草坪 + 荷叶
  rect(ctx, 0, homeTop, w, water1, P.grassDeep);
  rect(ctx, 0, homeTop, w, 2, P.grassHi);
  for (let x = 2; x < w; x += 15) {
    rect(ctx, x, 3, 9, 4, P.grass);
    rect(ctx, x + 2, 4, 5, 2, P.mint);
  }

  // 两层河道
  for (let i = 0; i < 2; i += 1) {
    const top = i === 0 ? water1 : water2;
    rect(ctx, 0, top, w, 9, P.purple);
    rect(ctx, 0, top, w, 1, P.line);
    rect(ctx, 0, top + 8, w, 1, P.line);
    for (let x = -6; x < w; x += 17) {
      rect(ctx, x + i * 5, top + 3, 6, 1, P.lav);
      rect(ctx, x + i * 5 + 4, top + 5, 5, 1, P.lineHi);
    }
  }

  // 中间安全带
  rect(ctx, 0, safeTop, w, roadTop - safeTop, P.grass);
  rect(ctx, 0, safeTop, w, 1, P.grassHi);
  for (let x = 3; x < w; x += 8) rect(ctx, x, safeTop + 2, 1, 2, P.grassDeep);

  // 车道 + 一辆开过去的车
  rect(ctx, 0, roadTop, w, startTop - roadTop, P.panel);
  rect(ctx, 0, roadTop, w, 1, P.hole);
  rect(ctx, 0, startTop - 1, w, 1, P.hole);
  for (let x = 0; x < w; x += 10) rect(ctx, x, roadTop + 4, 5, 1, P.lineHi);
  const carX = Math.round(((time * 13) % (w + 18)) - 9);
  // 车：两台不同配色，一左一右
  for (let i = 0; i < 2; i += 1) {
    const x = i === 0 ? carX : w - carX - 12;
    const body = i === 0 ? P.red : P.amber;
    rect(ctx, x, roadTop + 2, 12, 5, body);
    rect(ctx, x + 2, roadTop + 1, 8, 1, i === 0 ? P.orange : P.gold);
    rect(ctx, x + 3, roadTop + 3, 6, 2, P.lineHi);
    rect(ctx, x + 1, roadTop + 7, 2, 1, P.void);
    rect(ctx, x + 9, roadTop + 7, 2, 1, P.void);
  }

  // 起点草
  rect(ctx, 0, startTop, w, h - startTop, P.grassDeep);
  rect(ctx, 0, startTop, w, 1, P.grass);
  for (let x = 2; x < w; x += 7) rect(ctx, x, startTop + 3, 3, 2, P.grass);

  // 漂动的木头：两根，方向相反
  const drift = Math.round(wave(time, 0.11) * 10);
  const log1X = 4 + drift;
  const log2X = w - 46 - drift;
  drawMiniLog(ctx, log1X, water1 + 2, 26);
  drawMiniLog(ctx, log2X, water2 + 2, 30);

  // 青蛙踩在下面那根木头上，随木头一起横移
  const hopping = Math.sin(time * 3.2) > 0.6;
  drawFrog(
    ctx,
    log2X + 17,
    water2 + 5 + (hopping ? -2 : 0),
    hopping,
    false,
    time,
  );

  // 对岸小旗 + 高光
  drawBankFlag(ctx, w - 11, 9, time);
  if (Math.sin(time * 2.2) > 0.1) sparkle(ctx, 9, 22, 1, P.gold, P.white);

  // 外框
  rect(ctx, 0, 0, w, 1, P.line);
  rect(ctx, 0, h - 1, w, 1, P.line);
  rect(ctx, 0, 0, 1, h, P.line);
  rect(ctx, w - 1, 0, 1, h, P.line);
}

/** 缩略图专用的迷你木头：5px 高，不参与游戏逻辑。 */
function drawMiniLog(ctx: CanvasRenderingContext2D, x: number, y: number, w: number): void {
  rect(ctx, x, y, w, 5, P.dirt);
  rect(ctx, x, y, w, 1, P.dirtHi);
  rect(ctx, x, y + 4, w, 1, P.dirtDeep);
  for (let i = 3; i < w - 3; i += 7) rect(ctx, x + i, y + 2, 3, 1, P.dirtDeep);
}

export const meta: GameMeta = {
  id: "hop",
  no: 18,
  title: "青蛙过河",
  tagline: "躲开车，踩着木头过河",
  howto:
    "方向键或滑动让青蛙一格一格往前跳：躲开车道上的汽车，跳进河里要踩住漂来的木头，木头会把你带着走，站空就落水。每第一次到达一行得 10 分，跳到对岸得 100 分并回到起点，三条命用完就结束。",
  hint: "方向键 / WASD 跳一格 · 滑动也可 · <kbd>空格</kbd> 暂停",
  duration: "1–3 分钟",
  tags: ["每行 +10", "到对岸 +100", "落水撞车即减命"],
  size: { w: 168, h: 210 },
  scoreMode: "high",
  pad: {
    dpad: "four",
    a: { action: "primary", label: "前进" },
  },
  hud: [
    { key: "score", label: "分数", kind: "number", pad: 5, minChars: 5, tone: "score" },
    { key: "lives", label: "生命", kind: "number", pad: 2, minChars: 2, tone: "red" },
    { key: "row", label: "最远行", kind: "number", pad: 2, minChars: 2, tone: "mint" },
  ],
  drawThumb,
};
