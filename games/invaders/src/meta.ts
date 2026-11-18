import { P, rect, sparkle, wave, type GameMeta } from "@arcade/core";

import { drawEnemy, drawShip, type EnemyKind } from "./art";

/** 缩略图里两排敌机：三种颜色轮换。 */
const THUMB_KINDS: readonly (readonly EnemyKind[])[] = [
  [0, 1, 2],
  [2, 0, 1],
];

/** 首页缩略图：80×50 逻辑像素，夜空中一小队入侵者与飞船。 */
function drawThumb(ctx: CanvasRenderingContext2D, w: number, h: number, time: number): void {
  rect(ctx, 0, 0, w, h, P.void);
  rect(ctx, 0, 0, w, 1, P.night);
  rect(ctx, 0, h - 1, w, 1, P.night);

  // 静态星点，位置用简单公式排开，避免每帧随机跳。
  for (let i = 0; i < 24; i += 1) {
    const x = (i * 37 + 11) % w;
    const y = (i * 23 + 7) % h;
    rect(ctx, x, y, 1, 1, i % 4 === 0 ? P.lav : P.line);
  }

  const frame = Math.floor(time * 2.4) % 2;
  for (let row = 0; row < THUMB_KINDS.length; row += 1) {
    const kinds = THUMB_KINDS[row]!;
    for (let col = 0; col < kinds.length; col += 1) {
      drawEnemy(ctx, 20 + col * 14, 6 + row * 11, kinds[col] ?? 0, frame);
    }
  }

  // 一颗曳光弹和飞船。
  const bulletY = 27 + Math.round(wave(time, 0.6) * 2);
  rect(ctx, 40, bulletY, 1, 3, P.cream);
  rect(ctx, 40, bulletY, 1, 1, P.white);

  drawShip(ctx, 35, 39, Math.floor(time * 8) % 2);

  const pulse = wave(time, 0.5);
  sparkle(ctx, 11, 12, pulse > 0.55 ? 2 : 1, P.gold, P.white);
  sparkle(ctx, 70, 31, 1, P.amber, P.cream);
  sparkle(ctx, 64, 9, pulse > 0.7 ? 1 : 0, P.cream, P.white);
}

export const meta: GameMeta = {
  id: "invaders",
  no: 4,
  title: "像素入侵者",
  tagline: "五波敌机，守住最后一行",
  howto:
    "飞船会自动开火，你只管左右闪避。四行敌机整队推进，碰到边界就下压；五波全部清空才算守住。被击中会短暂无敌，三条命用完就结束。",
  hint: "拖动 / 鼠标跟随飞船 · <kbd>←</kbd> <kbd>→</kbd> / <kbd>A</kbd> <kbd>D</kbd> 移动 · 自动射击 · <kbd>空格</kbd> 暂停",
  duration: "2–4 分钟",
  tags: ["敌机 10/20/30", "每波加速", "3 条命"],
  size: { w: 168, h: 210 },
  scoreMode: "high",
  hud: [
    { key: "score", label: "分数", kind: "number", pad: 5, minChars: 5, tone: "score" },
    { key: "wave", label: "波次", kind: "number", pad: 2, minChars: 2, tone: "combo" },
    { key: "lives", label: "生命", kind: "number", pad: 2, minChars: 2, tone: "none" },
  ],
  drawThumb,
};
