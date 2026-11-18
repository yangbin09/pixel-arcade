import { P } from "../palette";
import { rect } from "../render/draw";
import { drawPixelText, measurePixelText } from "../render/font";
import { clamp } from "../util";

/**
 * 通用 3-2-1 倒计时面板：和打地鼠的 GET READY 面板同一套像素样式。
 * 画在独立的特效层上，不打断游戏自己的静态画面。
 */
export function drawCountdownOverlay(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  remainingMs: number,
  totalMs: number,
): void {
  const n = clamp(Math.ceil(remainingMs / 1000), 1, 3);
  const color = n === 1 ? P.red : n === 2 ? P.gold : P.amber;
  const pw = 128;
  const ph = 122;
  const x = Math.round((w - pw) / 2);
  const y = Math.round((h - ph) / 2);

  ctx.save();
  ctx.globalAlpha = 0.6;
  ctx.fillStyle = P.void;
  ctx.fillRect(0, 0, w, h);
  ctx.globalAlpha = 1;

  // 硬阴影 + 面板
  rect(ctx, x + 4, y + 4, pw, ph, P.void);
  rect(ctx, x, y, pw, ph, P.night);
  rect(ctx, x, y, pw, 2, P.lineHi);
  rect(ctx, x, y + ph - 2, pw, 2, P.lineHi);
  rect(ctx, x, y, 2, ph, P.lineHi);
  rect(ctx, x + pw - 2, y, 2, ph, P.lineHi);
  rect(ctx, x + 2, y + 2, pw - 4, 2, P.amber);

  // 四角铆钉
  rect(ctx, x + 4, y + 6, 2, 2, P.cream);
  rect(ctx, x + pw - 6, y + 6, 2, 2, P.cream);
  rect(ctx, x + 4, y + ph - 8, 2, 2, P.cream);
  rect(ctx, x + pw - 6, y + ph - 8, 2, 2, P.cream);

  const label = "GET READY";
  const labelW = measurePixelText(label, 2);
  drawPixelText(ctx, label, (w - labelW) / 2, y + 15, 2, P.lav, P.void);

  const text = String(n);
  const textW = measurePixelText(text, 10);
  drawPixelText(ctx, text, (w - textW) / 2, y + 36, 10, color, P.orange);

  // 底部三个进度点：先垫一条暗底，避免被数字的硬阴影盖住
  rect(ctx, x + 46, y + 108, 40, 12, P.night);
  for (let i = 0; i < 3; i += 1) {
    rect(ctx, x + 51 + i * 10, y + 111, 6, 4, i < n ? color : P.line);
  }

  ctx.restore();

  // totalMs 目前不参与绘制，保留参数给以后做进度环
  void totalMs;
}
