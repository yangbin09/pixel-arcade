import { P, rect, type GameMeta } from "@arcade/core";
import { drawApple, drawSnakeHead, drawSnakeSegment } from "./art";

/** 首页缩略图：80×50 逻辑像素，和游戏画面共用一套像素素材。 */
function drawThumb(ctx: CanvasRenderingContext2D, w: number, h: number, time: number): void {
  rect(ctx, 0, 0, w, h, P.line);
  rect(ctx, 2, 2, w - 4, h - 4, P.night);

  // 淡网格
  ctx.save();
  ctx.globalAlpha = 0.38;
  for (let x = 12; x < w - 3; x += 10) rect(ctx, x, 3, 1, h - 6, P.line);
  for (let y = 12; y < h - 3; y += 10) rect(ctx, 3, y, w - 6, 1, P.line);
  ctx.restore();

  // 一条向右游的小蛇 + 前方苹果
  drawSnakeSegment(ctx, 12, 28, "tail", 0);
  drawSnakeSegment(ctx, 22, 28, "body", 1);
  drawSnakeSegment(ctx, 32, 28, "body", 2);
  drawSnakeHead(ctx, 42, 28, "right", Math.sin(time * 3) > 0.4);
  drawApple(ctx, 62, 12, time);

  // 四角铆钉
  rect(ctx, 1, 1, 2, 2, P.lineHi);
  rect(ctx, w - 3, 1, 2, 2, P.lineHi);
  rect(ctx, 1, h - 3, 2, 2, P.lineHi);
  rect(ctx, w - 3, h - 3, 2, 2, P.lineHi);
}

export const meta: GameMeta = {
  id: "snake",
  no: 2,
  title: "贪吃蛇",
  tagline: "吃到 20 颗，别咬到自己",
  howto: "方向键 / WASD 或滑动转向，吃掉果实会变长，每 5 颗提速。撞墙或咬到自己就结束。",
  hint: "方向键 / WASD 转向 · 滑动也能玩 · <kbd>空格</kbd> 暂停",
  duration: "1–3 分钟",
  tags: ["果实 +10", "每 5 颗加速", "撞墙或咬到自己结束"],
  size: { w: 168, h: 168 },
  scoreMode: "high",
  scoreLabel: "本局得分",
  bestLabel: "历史最高",
  hud: [
    { key: "score", label: "分数", kind: "number", pad: 5, minChars: 5, tone: "score" },
    { key: "length", label: "长度", kind: "number", minChars: 2, tone: "combo" },
    { key: "best", label: "最高", kind: "number", pad: 5, minChars: 5, tone: "time" },
  ],
  drawThumb,
};
