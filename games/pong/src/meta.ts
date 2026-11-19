import { P, rect, sparkle, wave, type GameMeta } from "@arcade/core";

import { AI_TONE, PLAYER_TONE, drawBall, drawMiniCourt, drawMiniPaddle } from "./art";
import { FIELD } from "./logic";

/** 缩略图里的迷你球场：80×50 卡片正中一块 34×44 的竖场。 */
const MINI_W = 34;
const MINI_H = 44;

/** 首页缩略图：80×50 逻辑像素，和游戏画面共用 art.ts 的像素素材。 */
function drawThumb(ctx: CanvasRenderingContext2D, w: number, h: number, time: number): void {
  rect(ctx, 0, 0, w, h, P.void);

  // 卡片背景的斜向扫描线，和机台屏幕的质感一致。
  ctx.globalAlpha = 0.5;
  for (let y = 0; y < h; y += 3) rect(ctx, 0, y, w, 1, P.night);
  ctx.globalAlpha = 1;

  const boxX = Math.round((w - MINI_W) / 2);
  const boxY = Math.round((h - MINI_H) / 2);
  drawMiniCourt(ctx, { x: boxX, y: boxY, w: MINI_W, h: MINI_H });

  const padW = 13;
  const padMargin = 5;

  // AI 挡板在上方，跟着球的横坐标慢半拍地晃。
  const aiX = boxX + MINI_W / 2 + Math.sin(time * 1.5) * 6;
  drawMiniPaddle(ctx, aiX, boxY + padMargin, padW, AI_TONE);

  // 玩家挡板在下方，跟着球走。
  const ballBoxX = boxX + MINI_W / 2;
  const ballBoxTop = boxY + padMargin + 3;
  const ballBoxBottom = boxY + MINI_H - padMargin - 3;
  const span = ballBoxBottom - ballBoxTop;
  const cycle = (time * 0.7) % 2;
  const travel = cycle < 1 ? cycle : 2 - cycle;
  const ballY = ballBoxTop + travel * span;
  const ballX = ballBoxX + Math.sin(time * 2.6) * 9;

  const playerX = ballBoxX + Math.sin(time * 1.1) * 8;
  drawMiniPaddle(ctx, playerX, boxY + MINI_H - padMargin - 1, padW, PLAYER_TONE);

  drawBall(ctx, ballX, ballY, wave(time, 1.6) > 0.5);

  // 两处装饰星芒，时间驱动。
  const pulse = wave(time, 0.7);
  sparkle(ctx, boxX - 5, boxY + 8, pulse > 0.6 ? 2 : 1, P.gold, P.white);
  sparkle(ctx, boxX + MINI_W + 5, boxY + MINI_H - 12, 1, P.amber, P.cream);

  // 四角折线，和游戏的球场外框呼应。
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
  id: "pong",
  no: 20,
  title: "像素乒乓",
  tagline: "七分制，球越打越快",
  howto:
    "上下移动挡板把球挡回去，球会越打越快，先拿七分取胜。击中挡板的位置决定反弹角度，打边角更难接；每接住一次球再加一点分，接得越多分数越高。挡板速度有限，别指望它自己救球。",
  hint:
    "拖动挡板 / <kbd>←</kbd> <kbd>→</kbd> 移动 · <kbd>空格</kbd> / <kbd>Enter</kbd> 发球 · <kbd>P</kbd> 暂停",
  duration: "1–3 分钟",
  tags: ["七分制", "每回合加速", "拍数越多分越高"],
  size: { w: FIELD, h: FIELD },
  scoreMode: "high",
  spaceAction: "action",
  countdown: false,
  pad: {
    dpad: "lr",
    a: { action: "action", label: "发球" },
  },
  hud: [
    { key: "score", label: "得分", kind: "number", pad: 2, minChars: 2, tone: "score" },
    { key: "ai", label: "对手", kind: "number", pad: 2, minChars: 2, tone: "red" },
    { key: "rally", label: "回合", kind: "number", pad: 2, minChars: 2, tone: "combo" },
  ],
  drawThumb,
};
