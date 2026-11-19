import { P, rect, type GameMeta } from "@arcade/core";

import { drawMiniMachine } from "./art";
import { H, W } from "./logic";

/** 首页缩略图：80×50 逻辑像素，和游戏画面共用 art.ts 的像素素材。 */
function drawThumb(ctx: CanvasRenderingContext2D, w: number, h: number, time: number): void {
  rect(ctx, 0, 0, w, h, P.void);
  // 卡片背景的斜向扫描线，和机台屏幕的质感一致。
  ctx.globalAlpha = 0.5;
  for (let y = 0; y < h; y += 3) rect(ctx, 0, y, w, 1, P.night);
  ctx.globalAlpha = 1;

  const boxW = 46;
  const boxH = 42;
  const box = {
    x: Math.round((w - boxW) / 2),
    y: Math.round((h - boxH) / 2),
    w: boxW,
    h: boxH,
  };

  drawMiniMachine(ctx, box, (Math.sin(time * 0.9) + 1) / 2, time);

  // 四角折线，和机柜外壳呼应。
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
  id: "claw",
  no: 19,
  title: "像素抓娃娃",
  tagline: "对准了再下钩",
  howto:
    "左右移动爪子对准奖品，按 A 下钩。抓取率取决于瞄准偏差：正中 92%，偏 24px 只剩 6%，连抓每次再 +4%。三档奖品 10 / 25 / 60 分，十次机会用完结算。",
  hint:
    "拖动 / <kbd>←</kbd> <kbd>→</kbd> 移动爪子 · <kbd>空格</kbd> 下钩 · <kbd>P</kbd> 暂停",
  duration: "60–90 秒",
  tags: ["越准越好抓", "三档奖品", "十次机会"],
  size: { w: W, h: H },
  scoreMode: "high",
  spaceAction: "action",
  pad: {
    dpad: "lr",
    a: { action: "action", label: "下钩" },
  },
  hud: [
    { key: "score", label: "得分", kind: "number", pad: 5, minChars: 5, tone: "score" },
    { key: "tries", label: "机会", kind: "number", pad: 2, minChars: 2, tone: "red" },
    { key: "streak", label: "连抓", kind: "number", pad: 2, minChars: 2, tone: "gold" },
  ],
  drawThumb,
};
