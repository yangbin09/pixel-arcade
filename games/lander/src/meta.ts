import { P, rect, wave, type GameMeta } from "@arcade/core";

import { drawLander, drawPadMarker, drawStars, drawTerrain } from "./art";

/** 缩略图里的月面高度（80×50 逻辑像素里的一条地平线）。 */
const THUMB_GROUND = 38;

/**
 * 首页缩略图：80×50 逻辑像素，与游戏画面共用 art.ts 的像素素材。
 * 一帧正在软着陆的定格：小着陆器悬在停机坪上方，尾焰刚好点着。
 */
function drawThumb(ctx: CanvasRenderingContext2D, w: number, h: number, time: number): void {
  rect(ctx, 0, 0, w, h, P.void);
  rect(ctx, 0, 0, w, THUMB_GROUND, P.night);

  drawStars(ctx, w, THUMB_GROUND - 6, time, 26);

  // 缩略图专用的小地形：中间一条停机坪（宽度同样按 34px 下限），两边岩石。
  const terrain = {
    pads: [{ x: 22, w: 34 }],
    rocks: [
      { x: 0, w: 22 },
      { x: 56, w: w - 56 },
    ],
  };
  drawTerrain(ctx, terrain, THUMB_GROUND, w, h);
  drawPadMarker(ctx, terrain.pads[0]!, THUMB_GROUND, time);

  const bob = Math.round(wave(time, 0.45) * 3);
  const tilt = 0.12 * Math.sin(time * 1.3);
  drawLander(ctx, 39, THUMB_GROUND - 5 - bob, tilt, true, Math.floor(time * 9));

  // 落地扬尘：两粒缓慢外扩的浅粉像素。
  rect(ctx, 33, THUMB_GROUND - 1, 2, 1, P.pink);
  rect(ctx, 44, THUMB_GROUND - 1, 2, 1, P.pink);
}

export const meta: GameMeta = {
  id: "lander",
  no: 25,
  title: "月面着陆",
  tagline: "一个喷嘴，稳着落",
  howto:
    "按住 A 或空格点火反推，左右键（或手柄十字键）调整姿态。落地时速度越小、机身越正，评价越高：perfect 和 good 算成功着陆，会立刻开始下一段下降；rough 船体受损，本局结束。撞到两侧岩石直接坠毁。着陆带的宽度至少 34 像素，越省油、越靠停机坪中心，得分越高。",
  hint: "按住 <kbd>空格</kbd> / <kbd>A</kbd> 点火 · <kbd>←</kbd> <kbd>→</kbd> 调整姿态 · <kbd>P</kbd> 暂停",
  duration: "30 秒–2 分钟",
  tags: ["剩余燃料加分", "倾斜过大即坠毁", "软着陆有奖"],
  size: { w: 168, h: 210 },
  pad: {
    dpad: "lr",
    a: { action: "action", label: "推进" },
  },
  scoreMode: "high",
  // 点火是「按住」操作，空格比暂停更适合这里。
  spaceAction: "action",
  countdown: false,
  hud: [
    { key: "score", label: "分数", kind: "number", pad: 5, minChars: 5, tone: "score" },
    { key: "fuel", label: "燃料", kind: "number", pad: 3, minChars: 3, tone: "gold" },
    { key: "alt", label: "高度", kind: "number", pad: 3, minChars: 3, tone: "mint" },
  ],
  drawThumb,
};
