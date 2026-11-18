import { P, rect, sparkle, type GameMeta } from "@arcade/core";

import { drawMeteor, drawShieldRing, drawShip } from "./art";

/** 首页缩略图：80×50 的深空、三颗落石和一艘带护盾的飞船。 */
function drawThumb(ctx: CanvasRenderingContext2D, w: number, h: number, time: number): void {
  rect(ctx, 0, 0, w, h, P.night);

  // 上方微亮
  ctx.save();
  ctx.globalAlpha = 0.35;
  rect(ctx, 0, 0, w, 16, P.panel);
  ctx.globalAlpha = 0.16;
  rect(ctx, 0, 16, w, 12, P.panel);
  ctx.restore();

  // 固定星尘
  for (let i = 0; i < 28; i += 1) {
    const x = (i * 37 + 11) % w;
    const y = (i * 13 + 5) % (h - 14);
    rect(ctx, x, y, 1, 1, i % 5 === 0 ? P.lav : P.lineHi);
  }

  // 地平线光带
  const base = h - 6;
  for (let x = 0; x < w; x += 1) {
    const arch = Math.round(Math.sin((x / (w - 1)) * Math.PI) * 2);
    rect(ctx, x, base + arch, 1, 1, P.lineHi);
    rect(ctx, x, base + arch + 1, 1, 1, P.purple);
  }

  // 三颗循环下落的陨石
  const fall = (time * 18) % 40;
  const lanes = [16, 47, 67];
  for (let i = 0; i < 3; i += 1) {
    const y = 2 + ((fall + i * 13) % 34);
    if (y > h - 13) continue;
    drawMeteor(ctx, lanes[i] ?? 16, y, 2.5 + i, time * (1.4 + i * 0.4) + i, i % 4);
  }

  // 飞船 + 呼吸的护盾环
  const shipX = Math.round(w / 2);
  const shipY = h - 15 + (Math.sin(time * 3.1) > 0.2 ? 1 : 0);
  drawShip(ctx, shipX, shipY, Math.floor(time * 8) % 2 === 0);
  drawShieldRing(ctx, shipX, shipY, 9, time * 1.7);

  // 高亮星
  if (Math.sin(time * 2.2) > 0.1) sparkle(ctx, 9, 9, 1, P.gold, P.white);
  sparkle(ctx, w - 8, 19, 1, P.cream, P.white);

  // 外框
  rect(ctx, 0, 0, w, 1, P.line);
  rect(ctx, 0, h - 1, w, 1, P.line);
  rect(ctx, 0, 0, 1, h, P.line);
  rect(ctx, w - 1, 0, 1, h, P.line);
}

export const meta: GameMeta = {
  id: "dodge",
  no: 8,
  title: "陨石雨",
  tagline: "撑过 45 秒，别被砸中",
  howto:
    "拖动飞船或按方向键移动，躲开从天而降的陨石；贴着陨石边缘擦过能加分，护盾可以挡下一次撞击，撑满 45 秒就算活下来。",
  hint: "拖动飞船 · <kbd>方向键</kbd> / <kbd>WASD</kbd> 移动 · <kbd>空格</kbd> 暂停 · <kbd>F</kbd> 全屏",
  duration: "45 秒一局",
  tags: ["存活 +2/秒", "擦身 +15", "护盾挡一次"],
  size: { w: 168, h: 210 },
  pad: {
    dpad: "four",
  },
  scoreMode: "high",
  hud: [
    { key: "time", label: "时间", kind: "time", pad: 2, minChars: 2, tone: "time" },
    { key: "score", label: "分数", kind: "number", pad: 5, minChars: 5, tone: "score" },
    { key: "shield", label: "护盾", kind: "number", pad: 2, minChars: 2, tone: "mint" },
  ],
  drawThumb,
};
