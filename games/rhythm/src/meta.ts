import { P, rect, wave, type GameMeta } from "@arcade/core";

import {
  LANE_COLORS,
  drawThumbNote,
  drawThumbPad,
  drawThumbSparkle,
} from "./art";

/** 缩略图里的四轨 + 下落中的音符，一帧定格的「踩拍」画面。 */
function drawThumb(ctx: CanvasRenderingContext2D, w: number, h: number, time: number): void {
  rect(ctx, 0, 0, w, h, P.night);
  rect(ctx, 0, 0, w, 1, P.line);
  rect(ctx, 0, h - 1, w, 1, P.line);

  const lanes = 4;
  const bedW = 16;
  const gap = 2;
  const total = lanes * bedW + (lanes - 1) * gap;
  const ox = Math.round((w - total) / 2);
  const top = 6;
  const bedH = h - top - 5;

  for (let lane = 0; lane < lanes; lane += 1) {
    const x = ox + lane * (bedW + gap);
    drawThumbPad(ctx, x, top, bedW, bedH, lane);
  }

  // 判定线：一条横贯四轨的奶油色细线。
  const hitY = top + Math.round(bedH * 0.78);
  rect(ctx, ox - 2, hitY, total + 4, 1, P.cream);
  rect(ctx, ox - 2, hitY + 1, total + 4, 1, P.line);

  // 四个音符错落下落，用 wave 让它们在缩略图里缓慢上下浮动。
  const drift = [0, 3, 1, 5];
  for (let lane = 0; lane < lanes; lane += 1) {
    const x = ox + lane * (bedW + gap) + Math.floor((bedW - 10) / 2);
    const y = top + 5 + Math.round(wave(time * 0.5 + lane * 0.23, 1) * 12) + drift[lane]!;
    drawThumbNote(ctx, x, Math.min(y, hitY - 8), lane, 10);
  }

  // 最近的一个音符正好压在判定线上，配一颗闪光。
  const nearX = ox + 2 * (bedW + gap) + Math.floor((bedW - 10) / 2);
  drawThumbNote(ctx, nearX, hitY - 5, 2, 10);
  drawThumbSparkle(ctx, nearX + 5, hitY - 8, 2);

  // 左下角小节拍灯，四颗对应四轨。
  for (let lane = 0; lane < lanes; lane += 1) {
    const lit = wave(time * 2 + lane * 0.25, 1) > 0.72;
    rect(ctx, ox + lane * (bedW + gap) + 5, h - 3, 6, 2, lit ? LANE_COLORS[lane]! : P.line);
  }
}

export const meta: GameMeta = {
  id: "rhythm",
  no: 23,
  title: "四轨节拍",
  tagline: "四条轨道，踩准每一拍",
  howto:
    "四条轨道各对应一个键：左 / 下 / 上 / 右，或者直接点那条轨道。音符落到判定线时按下，误差 45 毫秒内是 PERFECT，90 毫秒内是 GOOD。连击越高单次得分越多，曲目 75 秒，BPM 会从 96 一路涨到 144。",
  hint: "方向键 / 点轨道击打 · <kbd>空格</kbd> 击打最近音符 · <kbd>P</kbd> 暂停",
  duration: "1–2 分钟",
  tags: ["PERFECT ±45ms", "连击加成", "BPM 递增"],
  size: { w: 168, h: 168 },
  spaceAction: "action",
  pad: {
    dpad: "four",
    a: { action: "action", label: "击打" },
    b: { action: "secondary", label: "击打" },
  },
  scoreMode: "high",
  scoreLabel: "本曲得分",
  bestLabel: "历史最高",
  countdown: false,
  hud: [
    { key: "score", label: "分数", kind: "number", pad: 5, minChars: 5, tone: "score" },
    { key: "combo", label: "连击", kind: "number", pad: 3, minChars: 3, tone: "combo" },
    { key: "acc", label: "准确率", kind: "text", minChars: 4, tone: "mint" },
  ],
  drawThumb,
};
