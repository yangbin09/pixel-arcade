import { P, rect, sparkle, strokeRect, type GameMeta } from "@arcade/core";

import { drawMiniBlock } from "./art";

/** 首页缩略图：80×50 逻辑像素，4 轨 20px，和游戏画面同一套配色。 */
function drawThumb(ctx: CanvasRenderingContext2D, w: number, h: number, time: number): void {
  const laneW = 20;
  const hitTop = h - 12;

  rect(ctx, 0, 0, w, h, P.night);
  for (let lane = 1; lane < 4; lane += 2) {
    rect(ctx, lane * laneW, 0, laneW, h, P.panel);
  }

  // 底部判定区 + 虚线。
  rect(ctx, 0, hitTop, w, h - hitTop, P.panel2);
  for (let x = 0; x < w; x += 6) {
    rect(ctx, x, hitTop, 3, 1, P.lineHi);
  }

  // 顶部投放槽与轨道分隔。
  rect(ctx, 0, 0, w, 3, P.void);
  rect(ctx, 0, 3, w, 1, P.line);
  for (let lane = 1; lane < 4; lane += 1) {
    rect(ctx, lane * laneW, 0, 1, h, P.line);
  }

  drawMiniBlock(ctx, 2, 8, 16, 10, 0);
  drawMiniBlock(ctx, 42, 18, 16, 10, 1);
  drawMiniBlock(ctx, 62, 30, 16, 10, 3);

  // 最低那块已经在判定区里，白边提示可以踩。
  strokeRect(ctx, 61, 29, 18, 12, P.white);
  const pulse = Math.sin(time * 4.2) > 0.15;
  sparkle(ctx, 77, 27, pulse ? 2 : 1, P.cream, P.white);

  // 地面线。
  rect(ctx, 0, h - 2, w, 2, P.lineHi);
  rect(ctx, 0, h - 1, w, 1, P.redDeep);
  for (let lane = 0; lane < 4; lane += 1) {
    rect(ctx, lane * laneW + 8, h - 6, 4, 2, P.lineHi);
  }

  rect(ctx, 0, 0, w, 1, P.lineHi);
  rect(ctx, 0, 0, 1, h, P.lineHi);
  rect(ctx, w - 1, 0, 1, h, P.lineHi);
}

export const meta: GameMeta = {
  id: "tiles",
  no: 9,
  title: "别踩白块",
  tagline: "四轨往下砸，踩错就结束",
  howto:
    "四条轨道不断落下方块，点中轨道里最靠下、已经进入底部判定区的方块就能得分。每 10 连击提升一档倍率与速度；点空轨道或方块落地都会立刻结束。",
  hint: "点击轨道 / 按 <kbd>1</kbd>–<kbd>4</kbd> 砸块 · <kbd>空格</kbd> 砸最下方 · <kbd>P</kbd> 暂停",
  duration: "30–90 秒",
  tags: ["每块 +10 ×连击", "每 10 块加速", "踩空即结束"],
  size: { w: 168, h: 252 },
  pad: {
    dpad: "lr",
    a: { action: "action", label: "命中" },
  },
  scoreMode: "high",
  scoreLabel: "本局得分",
  bestLabel: "历史最高",
  countdown: false,
  spaceAction: "action",
  hud: [
    { key: "score", label: "分数", kind: "number", pad: 5, minChars: 5, tone: "score" },
    { key: "combo", label: "连击", kind: "number", pad: 3, minChars: 3, tone: "combo", suffix: "×1" },
    { key: "speed", label: "速度", kind: "number", pad: 2, minChars: 2, tone: "time" },
  ],
  drawThumb,
};
