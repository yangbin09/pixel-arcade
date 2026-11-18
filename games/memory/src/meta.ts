import { P, rect, type GameMeta } from "@arcade/core";

import { CARD_SIZE, drawCardBack, drawCardFace, type IconId } from "./art";

/** 首页缩略图：80×50，两张牌 + 轻微浮动 + 周期性翻面。 */
function drawThumb(ctx: CanvasRenderingContext2D, w: number, h: number, time: number): void {
  rect(ctx, 0, 0, w, h, P.night);

  for (let y = 4; y < h; y += 6) {
    for (let x = y % 12 === 4 ? 4 : 7; x < w; x += 7) {
      rect(ctx, x, y, 1, 1, P.panel);
    }
  }

  rect(ctx, 0, 0, w, 1, P.line);
  rect(ctx, 0, h - 1, w, 1, P.line);
  rect(ctx, 0, 0, 1, h, P.line);
  rect(ctx, w - 1, 0, 1, h, P.line);

  const bob = Math.sin(time * 1.8) > 0.3 ? 1 : 0;
  const top = Math.round((h - CARD_SIZE) / 2) + bob;

  // 左边：牌背
  rect(ctx, 4, top + 2, CARD_SIZE, CARD_SIZE, P.void);
  drawCardBack(ctx, 2, top);

  // 右边：牌面，每 3.2 秒翻一次，星星和心交替
  const cycle = time % 3.2;
  let scale = 1;
  let icon: IconId = "star";
  if (cycle < 0.55) {
    const k = cycle / 0.55;
    scale = Math.abs(1 - k * 2);
    icon = k < 0.5 ? "heart" : "star";
  }
  const cw = Math.max(1, Math.round(CARD_SIZE * Math.max(0.04, scale)));
  const left = w - CARD_SIZE - 2 + Math.round((CARD_SIZE - cw) / 2);
  rect(ctx, left + 2, top + 2, cw, CARD_SIZE, P.void);
  ctx.save();
  ctx.beginPath();
  ctx.rect(left, top, cw, CARD_SIZE);
  ctx.clip();
  drawCardFace(ctx, icon, w - CARD_SIZE - 2, top);
  ctx.restore();

  const pulse = 0.5 + Math.sin(time * 2.6) * 0.5;
  if (pulse > 0.55) {
    rect(ctx, 4, 4, 1, 1, P.white);
    rect(ctx, 2, 5, 1, 1, P.gold);
    rect(ctx, 6, 5, 1, 1, P.gold);
  }
  if (pulse < 0.35) {
    rect(ctx, w - 4, h - 5, 1, 1, P.amber);
    rect(ctx, w - 6, h - 6, 1, 1, P.gold);
  }
}

export const meta: GameMeta = {
  id: "memory",
  no: 7,
  title: "记忆翻牌",
  tagline: "16 张牌，8 对图案",
  howto:
    "翻开两张牌比较图案：相同就留在桌面上，不同则短暂停留后盖回。记住每张牌的位置，把 8 对图案全部配对即通关；没有时间限制，用时越短纪录越好。",
  hint: "点击 / 轻触翻牌 · <kbd>方向键</kbd> 移动光标 · <kbd>Enter</kbd> 翻牌 · <kbd>空格</kbd> 暂停",
  duration: "30 秒–2 分钟",
  tags: ["配对成功 +1", "翻错扣步", "用时越短越好"],
  size: { w: 168, h: 168 },
  pad: {
    dpad: "four",
    a: { action: "action", label: "翻开" },
  },
  scoreMode: "low",
  scoreLabel: "用时（秒）",
  bestLabel: "最快纪录",
  countdown: false,
  hud: [
    { key: "time", label: "时间", kind: "time", pad: 3, minChars: 3, tone: "time" },
    { key: "moves", label: "步数", kind: "number", pad: 4, minChars: 4, tone: "combo" },
    { key: "pairs", label: "已配对", kind: "number", pad: 2, minChars: 2, tone: "mint" },
  ],
  drawThumb,
};
