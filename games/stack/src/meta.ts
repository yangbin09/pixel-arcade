import { P, rect, type GameMeta } from "@arcade/core";

import { drawMiniTower } from "./art";

/** 缩略图尺寸：首页卡片固定 80×50 逻辑像素。 */
const MINI_W = 72;
const MINI_H = 44;

/** 首页缩略图：80×50，一摞彩色方块 + 顶上正在摆动的下一块。 */
function drawThumb(ctx: CanvasRenderingContext2D, w: number, h: number, time: number): void {
  rect(ctx, 0, 0, w, h, P.void);

  // 背景扫描线，和机台屏幕的质感一致。
  ctx.globalAlpha = 0.45;
  for (let y = 0; y < h; y += 3) rect(ctx, 0, y, w, 1, P.night);
  ctx.globalAlpha = 1;

  const boxX = Math.round((w - MINI_W) / 2);
  const boxY = Math.round((h - MINI_H) / 2);
  drawMiniTower(ctx, boxX, boxY, MINI_W, MINI_H, time);

  // 四角折线，和游戏的机台边框呼应。
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
  id: "stack",
  no: 14,
  title: "像素堆塔",
  tagline: "对准了再落，越堆越窄",
  howto:
    "方块在顶端左右摆动，轻点画面或按下 A 键落下。与下一层重叠的部分会保留，超出的被裁掉；误差在 3 像素以内算完美，能把宽度加回来。重叠为零，塔就塌了。",
  hint: "轻点画面 / <kbd>空格</kbd> / <kbd>Enter</kbd> 落下 · <kbd>P</kbd> 暂停",
  duration: "45–90 秒",
  tags: ["完美 +连击", "越堆越快", "落空即结束"],
  size: { w: 168, h: 210 },
  scoreMode: "high",
  spaceAction: "action",
  pad: {
    a: { action: "action", label: "落下" },
  },
  hud: [
    { key: "score", label: "分数", kind: "number", pad: 5, minChars: 5, tone: "score" },
    { key: "floor", label: "层数", kind: "number", pad: 2, minChars: 2, tone: "combo" },
    { key: "combo", label: "完美", kind: "number", pad: 2, minChars: 2, tone: "gold" },
  ],
  drawThumb,
};
