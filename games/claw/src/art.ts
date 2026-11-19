import {
  P,
  bevel,
  clamp,
  drawPixelText,
  fillCircle,
  fillEllipse,
  line,
  measurePixelText,
  rect,
  sparkle,
  strokeRect,
} from "@arcade/core";

import { CHANCE_OFFSET_MAX, H, SHELF_Y, W, type Prize, type TierKey } from "./logic";

/* ---------------- 机台几何 ---------------- */

/** 外壳厚度、灯箱、玻璃区、顶部轨道与底部控制面板的位置（逻辑像素）。 */
export const FRAME = 3;
export const MARQUEE_Y = 4;
export const MARQUEE_H = 9;
export const RAIL_Y = 15;
export const GLASS_TOP = 18;
export const PANEL_Y = 190;
export const BIN_TOP = SHELF_Y + 6;

/** 三档奖品的配色：薄荷糖 / 薰衣草礼盒 / 金色小熊。 */
export interface PrizeLook {
  body: string;
  light: string;
  dark: string;
  accent: string;
}

export const PRIZE_LOOKS: Record<TierKey, PrizeLook> = {
  small: { body: P.mint, light: P.white, dark: P.grassDeep, accent: P.pink },
  mid: { body: P.lav, light: P.cream, dark: P.purple, accent: P.pink },
  big: { body: P.gold, light: P.cream, dark: P.orange, accent: P.pink },
};

/* ---------------- 奖品素材 ---------------- */

/** 小档：薄荷糖 —— 圆糖体 + 两侧糖纸。 */
function drawCandy(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  const cx = Math.round(x + w / 2);
  const cy = Math.round(y + h / 2);
  const r = Math.max(3, Math.round(Math.min(w, h) / 2) - 1);
  const look = PRIZE_LOOKS.small;

  fillCircle(ctx, cx, cy, r, look.body);
  // 糖纸两翼
  const wing = Math.max(2, Math.round((w - r * 2) / 2));
  rect(ctx, cx - r - wing, cy - 2, wing, 4, look.accent);
  rect(ctx, cx + r, cy - 2, wing, 4, look.accent);
  // 高光与糖纸折线
  rect(ctx, cx - r + 1, cy - r + 1, 2, 2, look.light);
  rect(ctx, cx - r - wing, cy - 2, 1, 4, look.dark);
  rect(ctx, cx + r + wing - 1, cy - 2, 1, 4, look.dark);
}

/** 中档：薰衣草礼盒 —— 盒身 + 盖子 + 十字丝带 + 蝴蝶结。 */
function drawGift(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  const look = PRIZE_LOOKS.mid;
  const cx = Math.round(x + w / 2);
  const bodyH = Math.max(5, Math.round(h * 0.58));
  const bx = x + 1;
  const bw = Math.max(4, w - 2);
  const by = y + h - bodyH;
  const lidH = Math.max(2, Math.round(h * 0.2));

  rect(ctx, bx, by, bw, bodyH, look.body);
  rect(ctx, bx, by, bw, 1, look.light);
  rect(ctx, bx, by + bodyH - 1, bw, 1, look.dark);
  rect(ctx, bx + bw - 1, by, 1, bodyH, look.dark);

  // 盖子
  const lidY = Math.max(y, by - lidH);
  rect(ctx, bx - 1, lidY, bw + 2, lidH, look.dark);
  rect(ctx, bx - 1, lidY, bw + 2, 1, P.purple);
  rect(ctx, bx - 1, lidY + lidH - 1, bw + 2, 1, P.void);

  // 十字丝带
  rect(ctx, cx - 1, lidY, 2, h - (lidY - y), P.cream);
  // 蝴蝶结
  rect(ctx, cx - 3, y, 2, 2, look.accent);
  rect(ctx, cx + 2, y, 2, 2, look.accent);
  rect(ctx, cx - 1, y, 2, 1, P.white);
}

/** 大档：金色小熊 —— 圆脑袋 + 耳朵 + 奶油肚皮。 */
function drawBear(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  const look = PRIZE_LOOKS.big;
  const cx = Math.round(x + w / 2);
  const bottom = Math.round(y + h);
  const bodyRx = Math.max(3, Math.round(w * 0.3));
  const bodyRy = Math.max(3, Math.round(h * 0.24));
  const bodyCy = bottom - bodyRy - 1;
  const headR = Math.max(3, Math.round(w * 0.24));
  const headCy = bodyCy - bodyRy - Math.max(2, Math.round(h * 0.1));

  fillEllipse(ctx, cx, bodyCy, bodyRx, bodyRy, look.body);
  fillCircle(ctx, cx, headCy, headR, look.body);
  fillCircle(ctx, cx - headR + 1, headCy - headR + 1, Math.max(1, Math.round(headR / 2)), look.body);
  fillCircle(ctx, cx + headR - 1, headCy - headR + 1, Math.max(1, Math.round(headR / 2)), look.body);

  // 肚皮
  fillEllipse(ctx, cx, bodyCy + 1, Math.max(2, bodyRx - 2), Math.max(1, bodyRy - 2), look.light);
  // 口鼻
  rect(ctx, cx - 1, headCy, 3, Math.max(1, Math.round(headR / 2)), look.light);
  // 眼睛
  const eye = Math.max(1, headR - 2);
  rect(ctx, cx - eye, headCy - 1, 1, 1, P.void);
  rect(ctx, cx + eye - 1, headCy - 1, 1, 1, P.void);
  // 耳内
  rect(ctx, cx - headR, headCy - headR + 1, 1, 1, look.accent);
  rect(ctx, cx + headR - 1, headCy - headR + 1, 1, 1, look.accent);
}

/** 只画奖品本体（不含影子）：缩略图与游戏画面共用。 */
export function drawPrizeArt(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  tier: TierKey,
  _time = 0,
): void {
  if (w <= 0 || h <= 0) return;
  if (tier === "small") drawCandy(ctx, x, y, w, h);
  else if (tier === "mid") drawGift(ctx, x, y, w, h);
  else drawBear(ctx, x, y, w, h);
}

/** 四角括线：标记「这一钩盯着谁」。 */
export function drawBrackets(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  color: string,
): void {
  const arm = 3;
  const left = Math.round(x) - 2;
  const top = Math.round(y) - 2;
  const right = Math.round(x + w) + 1;
  const bottom = Math.round(y + h) + 1;

  rect(ctx, left, top, arm, 1, color);
  rect(ctx, left, top, 1, arm, color);
  rect(ctx, right - arm + 1, top, arm, 1, color);
  rect(ctx, right, top, 1, arm, color);
  rect(ctx, left, bottom, arm, 1, color);
  rect(ctx, left, bottom - arm + 1, 1, arm, color);
  rect(ctx, right - arm + 1, bottom, arm, 1, color);
  rect(ctx, right, bottom - arm + 1, 1, arm, color);
}

/** 货架上的奖品：投影 + 本体 +（可选）瞄准括线。 */
export function drawShelfPrize(
  ctx: CanvasRenderingContext2D,
  prize: Prize,
  time = 0,
  hot = false,
): void {
  const cx = Math.round(prize.x + prize.w / 2);
  ctx.globalAlpha = 0.4;
  fillEllipse(ctx, cx, SHELF_Y + 1, Math.max(3, Math.round(prize.w / 2)), 2, P.void);
  ctx.globalAlpha = 1;

  drawPrizeArt(ctx, prize.x, prize.y, prize.w, prize.h, prize.tier, time);
  if (hot) drawBrackets(ctx, prize.x, prize.y, prize.w, prize.h, P.gold);
}

/* ---------------- 机台 ---------------- */

/** 顶部灯箱：CLAW 灯牌 + 交替闪烁的灯珠。 */
function drawMarquee(ctx: CanvasRenderingContext2D, time: number): void {
  const x = 5;
  const w = W - 10;
  rect(ctx, x, MARQUEE_Y, w, MARQUEE_H, P.void);
  rect(ctx, x, MARQUEE_Y, w, 1, P.line);
  rect(ctx, x, MARQUEE_Y + MARQUEE_H - 1, w, 1, P.lineHi);

  const label = "CLAW";
  const labelW = measurePixelText(label, 1);
  drawPixelText(ctx, label, Math.round((W - labelW) / 2), MARQUEE_Y + 1, 1, P.gold, P.void);

  const beat = Math.floor(time * 3);
  for (let i = 0; i < 3; i += 1) {
    const on = (beat + i) % 3 !== 0;
    const color = on ? P.amber : P.dirtDeep;
    rect(ctx, 10 + i * 14, MARQUEE_Y + 4, 3, 2, color);
    rect(ctx, W - 13 - i * 14, MARQUEE_Y + 4, 3, 2, color);
  }
}

/** 背景玻璃：暗场 + 竖向条纹 + 两道反光。 */
function drawGlass(ctx: CanvasRenderingContext2D, time: number): void {
  const x = 6;
  const w = W - 12;
  const y = GLASS_TOP;
  const h = PANEL_Y - GLASS_TOP;
  rect(ctx, x, y, w, h, P.night);

  // 背板细纹
  for (let px = x + 6; px < x + w - 4; px += 12) {
    ctx.globalAlpha = 0.5;
    rect(ctx, px, y, 1, h, P.panel);
    ctx.globalAlpha = 1;
  }

  // 玻璃反光：两道倾斜高光
  ctx.globalAlpha = 0.1;
  rect(ctx, x + 10, y, 3, h, P.white);
  rect(ctx, x + 18, y, 1, h, P.white);
  rect(ctx, x + w - 26, y, 2, h, P.white);
  ctx.globalAlpha = 1;

  // 内框
  strokeRect(ctx, x, y, w, h, P.line);
  rect(ctx, x, y, w, 1, P.lineHi);

  // 底边一抹暖光，像机台内部的灯带
  const glow = Math.round(1 + Math.sin(time * 1.4));
  ctx.globalAlpha = 0.5;
  rect(ctx, x + 4, y + h - 4, w - 8, glow, P.purple);
  ctx.globalAlpha = 1;
}

/** 顶部轨道：导轨 + 铆钉。 */
function drawRail(ctx: CanvasRenderingContext2D): void {
  const x = 6;
  const w = W - 12;
  rect(ctx, x, RAIL_Y, w, 3, P.line);
  rect(ctx, x, RAIL_Y, w, 1, P.lineHi);
  rect(ctx, x, RAIL_Y + 2, w, 1, P.void);
  for (let px = x + 8; px < x + w - 4; px += 16) {
    rect(ctx, px, RAIL_Y + 1, 1, 1, P.lineHi);
  }
}

/** 奖品台 + 下方取物口（宽托盘，横跨爪子行程）。 */
function drawShelf(ctx: CanvasRenderingContext2D): void {
  const x = 6;
  const w = W - 12;

  // 台面
  rect(ctx, x, SHELF_Y, w, 6, P.panel2);
  rect(ctx, x, SHELF_Y, w, 1, P.lineHi);
  rect(ctx, x, SHELF_Y + 1, w, 1, P.panel);
  rect(ctx, x, SHELF_Y + 5, w, 1, P.void);
  for (let px = x + 4; px < x + w - 6; px += 14) {
    rect(ctx, px, SHELF_Y + 3, 6, 1, P.line);
  }

  // 取物托盘：从台面下沿一直摊到控制面板，横跨整个爪子行程。
  const binY = BIN_TOP;
  const binH = PANEL_Y - BIN_TOP;
  rect(ctx, x, binY, w, binH, P.void);
  rect(ctx, x, binY, w, 1, P.line);

  const trayX = x + 4;
  const trayW = w - 8;
  const trayY = binY + 3;
  const trayH = binH - 5;
  rect(ctx, trayX, trayY, trayW, trayH, P.hole);
  strokeRect(ctx, trayX, trayY, trayW, trayH, P.line);
  rect(ctx, trayX + 1, trayY + 1, trayW - 2, 1, P.dirtDeep);
  rect(ctx, trayX + 1, trayY + trayH - 1, trayW - 2, 1, P.panel);
  // 托盘里的两颗小奖品格子，纯装饰
  rect(ctx, trayX + 3, trayY + 3, 2, 2, P.dirtDeep);
  rect(ctx, trayX + trayW - 5, trayY + 4, 1, 1, P.dirt);
  rect(ctx, trayX + Math.round(trayW / 2), trayY + 3, 3, 1, P.dirtDeep);
}

/** 底部控制面板底：边框与铆钉（文字和概率条由 drawChanceMeter 画）。 */
function drawPanel(ctx: CanvasRenderingContext2D): void {
  const h = H - PANEL_Y;
  rect(ctx, 0, PANEL_Y, W, h, P.panel);
  rect(ctx, 0, PANEL_Y, W, 1, P.lineHi);
  rect(ctx, 0, PANEL_Y + 1, W, 1, P.line);
  rect(ctx, 0, H - 1, W, 1, P.void);
  // 面板左右两颗铆钉
  rect(ctx, 3, PANEL_Y + 3, 1, 1, P.line);
  rect(ctx, W - 4, PANEL_Y + 3, 1, 1, P.line);
}

/** 整台机柜的静态部分（每帧重画，矩形数量很少）。 */
export function drawCabinet(ctx: CanvasRenderingContext2D, time: number): void {
  rect(ctx, 0, 0, W, H, P.panel2);
  rect(ctx, 1, 1, W - 2, H - 2, P.panel);
  bevel(ctx, 0, 0, W, H, P.lineHi, P.void);
  rect(ctx, FRAME, FRAME, W - FRAME * 2, H - FRAME * 2, P.night);

  drawMarquee(ctx, time);
  drawGlass(ctx, time);
  drawRail(ctx);
  drawShelf(ctx);
  drawPanel(ctx);
}

/* ---------------- 爪子 ---------------- */

/** 轨道上的小车。 */
export function drawTrolley(ctx: CanvasRenderingContext2D, x: number): void {
  const cx = Math.round(x);
  rect(ctx, cx - 5, RAIL_Y - 2, 11, 6, P.panel2);
  rect(ctx, cx - 5, RAIL_Y - 2, 11, 1, P.lineHi);
  rect(ctx, cx - 5, RAIL_Y + 3, 11, 1, P.void);
  rect(ctx, cx - 1, RAIL_Y - 3, 3, 1, P.lineHi);
  rect(ctx, cx - 3, RAIL_Y, 7, 2, P.purple);
  rect(ctx, cx - 2, RAIL_Y + 1, 5, 1, P.lav);
}

/** 吊索：轨道小车到爪身。 */
export function drawCable(
  ctx: CanvasRenderingContext2D,
  x: number,
  fromY: number,
  toY: number,
): void {
  const cx = Math.round(x);
  const top = Math.round(fromY);
  const bottom = Math.round(toY);
  if (bottom <= top) return;
  rect(ctx, cx, top, 1, bottom - top, P.purple);
  for (let py = top + 2; py < bottom; py += 6) {
    rect(ctx, cx, py, 1, 1, P.lineHi);
  }
}

/**
 * 爪身与三根爪指。open 0 完全闭合，1 完全张开；
 * y 是爪身中心线（爪子悬在 y=24 就是这里）。
 */
export function drawClaw(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  open: number,
): void {
  const cx = Math.round(x);
  const top = Math.round(y);
  const spread = 2 + Math.round(clamp(open, 0, 1) * 4);

  // 吊环 + 爪身
  rect(ctx, cx - 1, top - 4, 3, 3, P.purple);
  rect(ctx, cx - 1, top - 3, 3, 1, P.lav);
  rect(ctx, cx - 3, top - 1, 7, 5, P.panel2);
  rect(ctx, cx - 3, top - 1, 7, 1, P.lineHi);
  rect(ctx, cx - 3, top + 3, 7, 1, P.void);
  rect(ctx, cx - 2, top, 5, 2, P.lav);
  rect(ctx, cx - 2, top + 1, 2, 1, P.cream);

  // 三根爪指
  const tipY = top + 12;
  line(ctx, cx - 2, top + 4, cx - spread, tipY, P.cream);
  line(ctx, cx + 2, top + 4, cx + spread, tipY, P.cream);
  line(ctx, cx, top + 4, cx, tipY - 2, P.lineHi);
  // 内勾
  rect(ctx, cx - spread, tipY - 1, 2, 1, P.cream);
  rect(ctx, cx + spread - 1, tipY - 1, 2, 1, P.cream);
  rect(ctx, cx - spread, tipY, 1, 1, P.lineHi);
  rect(ctx, cx + spread, tipY, 1, 1, P.lineHi);
}

/* ---------------- 瞄准辅助 ---------------- */

/**
 * 瞄准辅助：从爪子垂下的虚线、货架上 ±24px 的抓取窗口刻度，
 * 以及落在台面上的准星。颜色随当前概率由暗转亮。
 */
export function drawAimGuide(
  ctx: CanvasRenderingContext2D,
  clawX: number,
  chance: number,
  active: boolean,
): void {
  if (!active) return;
  const cx = Math.round(clawX);
  const hot = chance >= 0.7;
  const color = hot ? P.mint : chance >= 0.4 ? P.amber : P.red;

  // 垂直虚线：只画到奖品上方，不在奖品本体上留划痕。
  for (let py = 42; py < 138; py += 5) {
    ctx.globalAlpha = hot ? 0.55 : 0.32;
    rect(ctx, cx, py, 1, 3, color);
    ctx.globalAlpha = 1;
  }

  // ±24px 的抓取窗口：台面边沿上的两道刻度
  for (const dx of [-CHANCE_OFFSET_MAX, CHANCE_OFFSET_MAX]) {
    const tx = Math.round(clamp(cx + dx, 8, W - 9));
    rect(ctx, tx, SHELF_Y - 2, 1, 4, color);
    rect(ctx, tx - 1, SHELF_Y - 4, 3, 1, color);
    rect(ctx, tx, SHELF_Y - 3, 1, 1, color);
  }

  // 台面准星：落在货架线上，正对爪子中心
  rect(ctx, cx - 3, SHELF_Y, 7, 1, color);
  rect(ctx, cx, SHELF_Y - 2, 1, 5, color);
  rect(ctx, cx - 1, SHELF_Y, 1, 1, P.white);
}

/* ---------------- 控制面板上的概率条 ---------------- */

/**
 * 概率条 + 百分比 + 连抓加成。chance 是含加成后的最终概率；
 * bonus 是连抓带来的额外概率（0 表示没加成）。
 */
export function drawChanceMeter(
  ctx: CanvasRenderingContext2D,
  chance: number,
  bonus: number,
): void {
  const labelY = PANEL_Y + 3;
  const x = 44;
  const y = labelY;
  const w = 68;
  const h = 5;
  const ratio = clamp(chance, 0, 1);

  drawPixelText(ctx, "CHANCE", 7, labelY, 1, P.lav, P.void);

  rect(ctx, x - 1, y - 1, w + 2, h + 2, P.void);
  rect(ctx, x, y, w, h, P.panel2);
  rect(ctx, x, y, w, 1, P.line);

  const fill = Math.round(w * ratio);
  const color = ratio >= 0.7 ? P.mint : ratio >= 0.4 ? P.amber : P.red;
  if (fill > 0) {
    rect(ctx, x, y, fill, h, color);
    rect(ctx, x, y, fill, 1, P.cream);
  }
  // 每 20% 一格刻度
  for (let i = 1; i < 5; i += 1) {
    rect(ctx, x + Math.round((w * i) / 5), y, 1, h, P.void);
  }

  const percent = `${Math.round(ratio * 100)}%`;
  drawPixelText(ctx, percent, x + w + 4, y - 1, 1, P.cream, P.void);

  if (bonus > 0) {
    const text = `+${Math.round(bonus * 100)}%`;
    const width = measurePixelText(text, 1);
    drawPixelText(ctx, text, W - 7 - width, y - 1, 1, P.gold, P.void);
  }

  // 第二行：操作提示（中文只能出现在 HUD 标签 / 弹窗里，画布上统一用像素字）
  const hintY = PANEL_Y + 11;
  drawPixelText(ctx, "MOVE AIM", 7, hintY, 1, P.lav, P.void);
  const hint = "A DROP";
  drawPixelText(ctx, hint, W - 8 - measurePixelText(hint, 1), hintY, 1, P.lav, P.void);
  // 中间一条分隔小点，让两段提示不至于连成一句
  rect(ctx, Math.round(W / 2) - 1, hintY + 3, 3, 1, P.line);
}

/* ---------------- 反馈特效 ---------------- */

/** 抓中 / 失败时的环形火花。 */
export function drawBurst(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  life: number,
  tone: string,
): void {
  const t = clamp(life, 0, 1);
  if (t <= 0) return;
  const radius = Math.round((1 - t) * 12) + 2;
  const cx = Math.round(x);
  const cy = Math.round(y);

  ctx.globalAlpha = t;
  rect(ctx, cx - radius, cy, radius * 2 + 1, 1, tone);
  rect(ctx, cx, cy - radius, 1, radius * 2 + 1, tone);
  ctx.globalAlpha = t * 0.6;
  rect(ctx, cx - radius + 2, cy - radius + 2, 1, 1, P.white);
  rect(ctx, cx + radius - 2, cy + radius - 2, 1, 1, P.white);
  ctx.globalAlpha = 1;
  sparkle(ctx, cx, cy, 1, P.white, tone);
}

/** 飘字：+25 / MISS，向上飘并淡出。 */
export function drawFloatText(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  text: string,
  life: number,
  color: string,
): void {
  const t = clamp(life, 0, 1);
  if (t <= 0) return;
  const width = measurePixelText(text, 1);
  const px = clamp(Math.round(x - width / 2), 4, W - width - 4);
  const py = Math.round(y - (1 - t) * 14);
  ctx.globalAlpha = Math.min(1, t * 1.6);
  drawPixelText(ctx, text, px, py, 1, color, P.void);
  ctx.globalAlpha = 1;
}

/* ---------------- 首页缩略图 ---------------- */

/** 缩略图里的迷你机柜：灯箱、轨道、爪子、三档奖品。 */
export function drawMiniMachine(
  ctx: CanvasRenderingContext2D,
  box: { x: number; y: number; w: number; h: number },
  clawX: number,
  time: number,
): void {
  const { x, y, w, h } = box;
  rect(ctx, x, y, w, h, P.panel2);
  rect(ctx, x + 2, y + 2, w - 4, h - 4, P.night);
  rect(ctx, x, y, w, 1, P.lineHi);
  rect(ctx, x, y + h - 1, w, 1, P.void);
  rect(ctx, x + w - 1, y, 1, h, P.void);

  // 顶部灯箱
  rect(ctx, x + 3, y + 3, w - 6, 5, P.void);
  const label = "CLAW";
  const labelW = measurePixelText(label, 1);
  drawPixelText(ctx, label, Math.round(x + (w - labelW) / 2), y + 3, 1, P.gold, P.void);
  const on = Math.floor(time * 3) % 2 === 0;
  rect(ctx, x + 4, y + 5, 1, 1, on ? P.amber : P.dirtDeep);
  rect(ctx, x + w - 5, y + 5, 1, 1, on ? P.dirtDeep : P.amber);

  // 玻璃反光
  ctx.globalAlpha = 0.12;
  rect(ctx, x + 6, y + 9, 2, h - 20, P.white);
  ctx.globalAlpha = 1;

  // 轨道
  const railY = y + 10;
  rect(ctx, x + 3, railY, w - 6, 1, P.lineHi);

  // 吊索 + 爪
  const cx = Math.round(x + clamp(clawX, 0.15, 0.85) * w);
  const clawY = railY + 12;
  rect(ctx, cx, railY + 1, 1, clawY - railY, P.purple);
  rect(ctx, cx - 2, clawY - 1, 5, 3, P.panel2);
  rect(ctx, cx - 2, clawY, 5, 1, P.lav);
  line(ctx, cx - 1, clawY + 2, cx - 4, clawY + 6, P.cream);
  line(ctx, cx + 1, clawY + 2, cx + 4, clawY + 6, P.cream);
  line(ctx, cx, clawY + 2, cx, clawY + 5, P.lineHi);

  // 货架
  const shelfY = y + h - 10;
  rect(ctx, x + 3, shelfY, w - 6, 3, P.panel2);
  rect(ctx, x + 3, shelfY, w - 6, 1, P.lineHi);
  rect(ctx, x + 3, shelfY + 3, w - 6, h - (shelfY - y) - 3, P.void);

  // 三档奖品一字排开（小 / 中 / 大）
  const items: { tier: TierKey; w: number; h: number }[] = [
    { tier: "small", w: 12, h: 9 },
    { tier: "mid", w: 13, h: 11 },
    { tier: "big", w: 14, h: 13 },
  ];
  const step = Math.floor((w - 12) / 3);
  for (let i = 0; i < items.length; i += 1) {
    const item = items[i] as { tier: TierKey; w: number; h: number };
    const px = x + 5 + i * step + Math.round((step - item.w) / 2);
    drawPrizeArt(ctx, px, shelfY - item.h, item.w, item.h, item.tier, time);
  }

  // 星芒
  const pulse = Math.sin(time * 3.2) > 0;
  sparkle(ctx, x + w - 8, shelfY - 18, 1, P.gold, P.white);
  sparkle(ctx, x + 7, shelfY - 22, pulse ? 1 : 0, P.amber, P.cream);
}
