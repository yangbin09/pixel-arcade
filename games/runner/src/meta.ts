import { P, rect, sparkle, wave, type GameMeta } from "@arcade/core";

import { drawCoin, drawObstacle, drawRunner } from "./art";
import { OBSTACLE_SIZE } from "./logic";

const THUMB_GROUND = 37;

/**
 * 首页缩略图：80×50 逻辑像素。
 * 一条地平线上的小定格：正在跨木箱的跑者、两颗金币、一只掠过的飞鸟。
 * 所有素材都来自 art.ts，和游戏画面共用同一套调色板。
 */
function drawThumb(ctx: CanvasRenderingContext2D, w: number, h: number, time: number): void {
  rect(ctx, 0, 0, w, h, P.void);
  rect(ctx, 0, 0, w, THUMB_GROUND, P.night);

  // 星空：固定公式，不随帧乱跳
  for (let i = 0; i < 20; i += 1) {
    const x = (i * 23 + 9) % w;
    const y = (i * 17 + 3) % (THUMB_GROUND - 9);
    rect(ctx, x, y, 1, 1, i % 5 === 0 ? P.cream : i % 2 === 0 ? P.lav : P.line);
  }

  // 月亮
  rect(ctx, 60, 4, 5, 1, P.cream);
  rect(ctx, 58, 5, 9, 4, P.cream);
  rect(ctx, 60, 9, 5, 1, P.cream);
  rect(ctx, 61, 6, 2, 2, P.panel2);
  rect(ctx, 64, 8, 2, 1, P.panel2);

  // 远山：两条正弦剪影，缓慢横移
  drawThumbHills(ctx, w, THUMB_GROUND - 5, 8, P.panel, P.line, time * 5, 34);
  drawThumbHills(ctx, w, THUMB_GROUND, 4, P.purple, P.lav, time * 10, 22);

  // 跑道
  rect(ctx, 0, THUMB_GROUND, w, h - THUMB_GROUND, P.dirtDeep);
  rect(ctx, 0, THUMB_GROUND, w, 1, P.grassHi);
  rect(ctx, 0, THUMB_GROUND + 1, w, 2, P.grass);
  rect(ctx, 0, THUMB_GROUND + 4, w, 1, P.dirt);
  rect(ctx, 0, THUMB_GROUND + 7, w, 1, P.panel);

  // 飞鸟：在左上角慢慢横掠
  const birdX = 6 + Math.round(wave(time, 0.2) * 16);
  drawObstacle(ctx, "bird", birdX, 12, OBSTACLE_SIZE.bird.w, OBSTACLE_SIZE.bird.h, Math.floor(time * 6));

  // 木箱
  const box = OBSTACLE_SIZE.box;
  const boxX = 44;
  drawObstacle(ctx, "box", boxX, THUMB_GROUND - box.h, box.w, box.h);

  // 两颗金币：正好压在跳跃弧线上
  const spin = Math.floor(time * 8);
  drawCoin(ctx, boxX + 5, THUMB_GROUND - box.h - 11, spin);
  drawCoin(ctx, boxX + 15, THUMB_GROUND - box.h - 15, spin + 2);

  // 跑者：跨在箱子正上方
  drawRunner(ctx, 27, THUMB_GROUND - 11, "jump", Math.floor(time * 9));

  // 落地扬尘 + 星芒
  rect(ctx, 21, THUMB_GROUND - 2, 3, 1, P.dirtHi);
  rect(ctx, 30, THUMB_GROUND - 1, 2, 1, P.dirtHi);
  sparkle(ctx, boxX + 5, THUMB_GROUND - box.h - 16, wave(time, 0.7) > 0.55 ? 2 : 1, P.gold, P.white);
}

/** 缩略图专用的小山脊：周期正弦，左右无缝。 */
function drawThumbHills(
  ctx: CanvasRenderingContext2D,
  w: number,
  baseY: number,
  amplitude: number,
  color: string,
  crest: string,
  offset: number,
  period: number,
): void {
  for (let x = 0; x < w; x += 1) {
    const t = (((x + offset) % period) + period) % period / period;
    const hump = Math.sin(t * Math.PI);
    const height = Math.max(0, Math.round(amplitude * (0.7 * hump + 0.3 * hump * hump)));
    if (height <= 0) continue;
    rect(ctx, x, baseY - height, 1, height, color);
    rect(ctx, x, baseY - height, 1, 1, crest);
  }
}

export const meta: GameMeta = {
  id: "runner",
  no: 11,
  title: "像素跑酷",
  tagline: "跳过箱子，滑过横梁",
  howto:
    "跑道自动向左滚动，你只要跳和滑。点击画布、按空格或 A 键起跳，按住能跳更高，越过木箱；按 X 或 B 键下滑，从横梁底下钻过去。飞鸟悬在半空，别跳进它怀里。吃金币加 10 分，每 200 米提速一档，撞到障碍立即结束。",
  hint: "点击 / <kbd>空格</kbd> / <kbd>Enter</kbd> 跳（可长按蓄力）· <kbd>X</kbd> 滑行 · <kbd>P</kbd> 暂停",
  duration: "1–2 分钟",
  tags: ["金币 +10", "每 200 米提速", "撞到即结束"],
  size: { w: 168, h: 210 },
  scoreMode: "high",
  spaceAction: "action",
  pad: {
    a: { action: "action", label: "跳" },
    b: { action: "secondary", label: "滑" },
  },
  hud: [
    { key: "score", label: "分数", kind: "number", pad: 5, minChars: 5, tone: "score" },
    { key: "dist", label: "距离", kind: "number", pad: 4, minChars: 4, tone: "mint" },
    { key: "speed", label: "速度", kind: "number", pad: 2, minChars: 2, tone: "combo" },
  ],
  drawThumb,
};
