import { P, rect, wave, type GameMeta } from "@arcade/core";
import { drawHammer, drawHoleBack, drawHoleFront, drawMole, drawSparkle, paintGrass } from "./art";

/** 首页缩略图：80×50 逻辑像素，沿用旧 home.js 的构图。 */
function drawThumb(ctx: CanvasRenderingContext2D, w: number, h: number, time: number): void {
  paintGrass(ctx, w, h, 1337);

  rect(ctx, 0, 0, w, 2, P.night);
  rect(ctx, 0, h - 2, w, 2, P.night);

  const holeX = 28;
  const holeY = 38;
  drawHoleBack(ctx, holeX, holeY);

  const bob = Math.round(1 + Math.sin(time * 2.1));
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, w, holeY + 8);
  ctx.clip();
  drawMole(ctx, holeX, holeY - 24 + bob, "gold", {});
  ctx.restore();
  drawHoleFront(ctx, holeX, holeY);

  const hammerY = 33 + (Math.sin(time * 1.7 + 1) > 0 ? 0 : 1);
  drawHammer(ctx, 58, hammerY, false);

  const pulse = wave(time, 0.5);
  drawSparkle(ctx, 13, 15, pulse > 0.55 ? 2 : 1, P.gold);
  drawSparkle(ctx, 52, 8, 1, P.amber);
  drawSparkle(ctx, 72, 43, pulse > 0.7 ? 1 : 0, P.cream);

  rect(ctx, 0, 0, w, 1, P.dirtDeep);
  rect(ctx, 0, h - 1, w, 1, P.dirtDeep);
  rect(ctx, 0, 0, 1, h, P.dirtDeep);
  rect(ctx, w - 1, 0, 1, h, P.dirtDeep);
  rect(ctx, 2, 2, 1, 1, P.cream);
  rect(ctx, w - 3, h - 3, 1, 1, P.cream);
}

export const meta: GameMeta = {
  id: "whack",
  no: 1,
  title: "打地鼠",
  tagline: "30 秒一局 · 连击越打越高",
  howto: "地鼠会从土坑里冒头，敲中就得分。连击越高，分数倍率越高；金地鼠停留极短，但值 30 分。",
  hint: "按 <kbd>1</kbd>–<kbd>9</kbd> 也能敲 · <kbd>空格</kbd> 暂停 · <kbd>F</kbd> 全屏",
  duration: "30 秒一局",
  tags: ["地鼠 +10", "金鼠 +30", "连击 5 / 10 / 20 → ×2 / ×3 / ×4"],
  size: { w: 168, h: 168 },
  pad: {
    dpad: "four",
    a: { action: "action", label: "敲" },
  },
  scoreMode: "high",
  scoreLabel: "本局得分",
  bestLabel: "历史最高",
  countdown: false,
  hud: [
    { key: "time", label: "时间", kind: "time", pad: 2, minChars: 2, tone: "time" },
    { key: "score", label: "分数", kind: "number", pad: 5, minChars: 5, tone: "score" },
    { key: "combo", label: "连击", kind: "number", pad: 2, minChars: 2, tone: "combo", suffix: "×1" },
  ],
  drawThumb,
};
