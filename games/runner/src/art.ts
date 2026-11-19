import { P, bevel, fillCircle, rect, sparkle, strokeRect } from "@arcade/core";

import { BEAM_H, COIN_R, GROUND_Y, type ObstacleKind } from "./logic";

/**
 * 像素跑酷的素材：全部按逻辑像素落笔，颜色只来自 P。
 *
 * - paintBackdrop：静态天空 / 星尘 / 月亮 / 地面（每局只画一次，缓存成 layer）
 * - paintHillStrip：可横向无限平铺的山脊条（视差层，也是只画一次）
 * - drawRunner：站立 / 跳跃 / 滑行三种姿势，跑步 4 帧
 * - drawObstacle：箱子 / 横梁 / 飞鸟
 * - drawCoin：8×8 金币，靠横向压缩做旋转
 */

/** 只画一次的静态背景：夜空分层、固定星尘、月亮、地面。 */
export function paintBackdrop(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  rect(ctx, 0, 0, w, h, P.void);

  // 夜空分层：越靠近地面越亮一档，像城市光污染
  rect(ctx, 0, 0, w, 44, P.night);
  ctx.save();
  ctx.globalAlpha = 0.55;
  rect(ctx, 0, 44, w, 34, P.night);
  ctx.globalAlpha = 0.4;
  rect(ctx, 0, 78, w, 30, P.panel);
  ctx.globalAlpha = 0.22;
  rect(ctx, 0, 108, w, 22, P.panel);
  ctx.restore();

  // 固定星尘：整数公式排布，保证每次打开构图一致
  for (let i = 0; i < 46; i += 1) {
    const x = (i * 37 + 13) % w;
    const y = (i * 29 + 5) % 116;
    const tone = i % 7;
    rect(ctx, x, y, 1, 1, tone === 0 ? P.cream : tone < 3 ? P.lav : P.line);
    if (tone === 0) rect(ctx, x + 1, y + 1, 1, 1, P.line);
    if (tone === 1) rect(ctx, x - 1, y, 1, 1, P.line);
  }

  drawMoon(ctx, 132, 30, 11);

  // 地面：草皮 + 泥土，颜色从亮到暗往下压
  rect(ctx, 0, GROUND_Y, w, h - GROUND_Y, P.dirtDeep);
  rect(ctx, 0, GROUND_Y, w, 2, P.grassHi);
  rect(ctx, 0, GROUND_Y + 2, w, 4, P.grass);
  rect(ctx, 0, GROUND_Y + 6, w, 3, P.grassDeep);
  rect(ctx, 0, GROUND_Y + 9, w, 5, P.dirt);
  rect(ctx, 0, GROUND_Y + 14, w, 1, P.dirtHi);
  rect(ctx, 0, GROUND_Y + 15, w, h - GROUND_Y - 15, P.dirtDeep);

  // 泥土颗粒
  for (let i = 0; i < 36; i += 1) {
    const x = (i * 23 + 7) % w;
    const y = GROUND_Y + 18 + ((i * 13) % Math.max(1, h - GROUND_Y - 20));
    rect(ctx, x, y, i % 5 === 0 ? 2 : 1, 1, i % 3 === 0 ? P.dirt : P.panel);
  }
}

/** 月亮：奶白圆盘 + 月海 + 右下暗面。 */
function drawMoon(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number): void {
  ctx.save();
  ctx.globalAlpha = 0.12;
  fillCircle(ctx, cx, cy, r + 4, P.cream);
  ctx.globalAlpha = 0.22;
  fillCircle(ctx, cx, cy, r + 2, P.cream);
  ctx.restore();

  fillCircle(ctx, cx, cy, r, P.cream);
  fillCircle(ctx, cx - 3, cy - 2, 3, P.panel2);
  fillCircle(ctx, cx + 3, cy + 3, 2, P.panel2);
  rect(ctx, cx + 1, cy - 6, 3, 2, P.panel2);

  for (let dy = -r; dy <= r; dy += 1) {
    const half = Math.round(Math.sqrt(Math.max(0, r * r - dy * dy)));
    const from = Math.round(half * 0.6);
    rect(ctx, cx + from, cy + dy, half - from, 1, P.line);
  }
  sparkle(ctx, cx + 4, cy - 6, 1, P.gold, P.white);
}

/**
 * 一条可以横向无限平铺的山脊条：宽度 = period * 2，海拔基准 = baseY。
 * 用纯周期函数（波峰每 period 一个）保证左右接缝完全对齐，
 * 每帧只要 drawImage 两次就能做视差。
 */
export function paintHillStrip(
  ctx: CanvasRenderingContext2D,
  stripW: number,
  baseY: number,
  amplitude: number,
  color: string,
  crest: string,
  period: number,
): void {
  const safePeriod = Math.max(4, period);
  for (let x = 0; x < stripW; x += 1) {
    const t = (x % safePeriod) / safePeriod;
    const hump = Math.sin(t * Math.PI);
    const detail = Math.sin(t * Math.PI * 4) * 0.18;
    const height = Math.max(0, Math.round(amplitude * (0.72 * hump + 0.28 * hump * hump) + amplitude * detail));
    if (height <= 0) continue;
    const top = baseY - height;
    rect(ctx, x, top, 1, height, color);
    rect(ctx, x, top, 1, 1, crest);
    if (height > 6) rect(ctx, x, top + Math.floor(height / 2), 1, 1, crest);
  }
}

/** 地面装饰：小树 / 路灯 / 石块，按 kind 三选一。 */
export function drawScenery(
  ctx: CanvasRenderingContext2D,
  x: number,
  groundY: number,
  kind: number,
): void {
  if (kind === 0) {
    rect(ctx, x + 3, groundY - 12, 2, 12, P.dirtDeep);
    rect(ctx, x + 1, groundY - 18, 6, 6, P.grassDeep);
    rect(ctx, x, groundY - 22, 8, 5, P.grass);
    rect(ctx, x + 2, groundY - 24, 4, 3, P.grassHi);
    return;
  }
  if (kind === 1) {
    rect(ctx, x + 4, groundY - 26, 1, 26, P.lineHi);
    rect(ctx, x, groundY - 28, 9, 2, P.panel2);
    rect(ctx, x + 1, groundY - 26, 7, 2, P.panel2);
    ctx.save();
    ctx.globalAlpha = 0.3;
    rect(ctx, x, groundY - 24, 9, 4, P.amber);
    ctx.restore();
    rect(ctx, x + 3, groundY - 24, 3, 1, P.gold);
    return;
  }
  rect(ctx, x, groundY - 4, 6, 4, P.panel);
  rect(ctx, x + 1, groundY - 6, 4, 3, P.panel2);
  rect(ctx, x + 2, groundY - 6, 1, 1, P.lineHi);
}

/** 地面速度线：一排随世界滚动的短横线，满速时最密。 */
export function drawGroundDashes(
  ctx: CanvasRenderingContext2D,
  w: number,
  groundY: number,
  offset: number,
  count: number,
): void {
  const step = 22;
  const base = ((offset % step) + step) % step;
  for (let i = 0; i < count; i += 1) {
    const x = Math.round(i * step - base);
    if (x < -10 || x > w + 2) continue;
    rect(ctx, x, groundY + 17, 8, 1, P.dirt);
    rect(ctx, x + 2, groundY + 19, 5, 1, P.hole);
  }
}

/* ---------------- 玩家 ---------------- */

export type RunnerPose = "run" | "jump" | "slide";

/**
 * 玩家：中心 x、脚底 y 定位，站立 / 跳跃 16×30，滑行 16×16。
 * run 用 frame 0–3 摆腿，jump 收腿举臂，slide 横躺。
 */
export function drawRunner(
  ctx: CanvasRenderingContext2D,
  cx: number,
  feetY: number,
  pose: RunnerPose,
  frame = 0,
): void {
  const x = Math.round(cx) - 8;
  const feet = Math.round(feetY);

  if (pose === "slide") {
    drawSlide(ctx, x, feet);
    return;
  }

  const y = feet - 30;
  const step = ((frame % 4) + 4) % 4;

  // 头：琥珀色头发 + 肤色
  rect(ctx, x + 4, y, 7, 2, P.amber);
  rect(ctx, x + 3, y + 1, 9, 3, P.amber);
  rect(ctx, x + 2, y + 3, 2, 2, P.amber);
  rect(ctx, x + 5, y + 4, 6, 5, P.pink);
  rect(ctx, x + 4, y + 5, 1, 4, P.pink);
  rect(ctx, x + 8, y + 5, 1, 1, P.void);
  rect(ctx, x + 10, y + 6, 1, 2, P.pink);

  // 上衣
  rect(ctx, x + 4, y + 9, 7, 7, P.mint);
  rect(ctx, x + 3, y + 10, 1, 5, P.mint);
  rect(ctx, x + 11, y + 10, 1, 3, P.grassHi);
  rect(ctx, x + 5, y + 9, 5, 1, P.grassHi);

  // 短裤
  rect(ctx, x + 4, y + 16, 7, 4, P.lav);
  rect(ctx, x + 4, y + 16, 7, 1, P.purple);

  if (pose === "jump") {
    // 收腿 + 举臂
    rect(ctx, x + 4, y + 20, 3, 4, P.pink);
    rect(ctx, x + 8, y + 20, 3, 3, P.pink);
    rect(ctx, x + 2, y + 24, 5, 2, P.cream);
    rect(ctx, x + 8, y + 23, 4, 2, P.cream);
    rect(ctx, x + 2, y + 8, 2, 5, P.cream);
    rect(ctx, x + 11, y + 7, 2, 6, P.cream);
    rect(ctx, x + 12, y + 6, 1, 2, P.pink);
    return;
  }

  // 跑步：两条腿交替抬起，落地的脚正好踩到 feetY（= y+30）
  const front = step === 0 ? 0 : step === 1 ? 2 : step === 2 ? 0 : 2;
  const back = step === 0 ? 2 : step === 1 ? 0 : step === 2 ? 2 : 0;
  const frontTop = y + 20;
  const backTop = y + 20;
  const frontLen = 8 - front;
  const backLen = 8 - back;
  rect(ctx, x + 4, frontTop, 2, frontLen, P.pink);
  rect(ctx, x + 9, backTop, 2, backLen, P.pink);
  // 鞋：贴在腿下沿，落地的脚一定到达 y+30
  rect(ctx, x + 3 + front, frontTop + frontLen, 4, 2, P.cream);
  rect(ctx, x + 8 + back, backTop + backLen, 4, 2, P.cream);
  rect(ctx, x + 3 + front, frontTop + frontLen, 4, 1, P.white);

  // 手臂摆动
  rect(ctx, x + 2, y + 10 + front, 2, 5, P.cream);
  rect(ctx, x + 11, y + 10 + back, 2, 5, P.cream);
}

/** 滑行：16×16 横躺，头朝右、腿朝左。 */
function drawSlide(ctx: CanvasRenderingContext2D, x: number, feet: number): void {
  const y = feet - 16;

  rect(ctx, x, y + 10, 6, 3, P.lav);
  rect(ctx, x, y + 13, 4, 2, P.cream);
  rect(ctx, x + 4, y + 13, 2, 2, P.white);

  rect(ctx, x + 5, y + 8, 7, 5, P.mint);
  rect(ctx, x + 5, y + 8, 7, 1, P.grassHi);
  rect(ctx, x + 6, y + 13, 5, 2, P.lav);

  rect(ctx, x + 3, y + 6, 5, 2, P.cream);

  rect(ctx, x + 11, y + 5, 5, 6, P.pink);
  rect(ctx, x + 10, y + 4, 6, 2, P.amber);
  rect(ctx, x + 9, y + 6, 2, 3, P.amber);
  rect(ctx, x + 14, y + 7, 1, 1, P.void);
  rect(ctx, x + 13, y + 10, 3, 1, P.pink);
}

/* ---------------- 障碍 ---------------- */

/** 按种类画障碍；几何与 logic.obstacleBox 一一对应（传盒子左上角）。 */
export function drawObstacle(
  ctx: CanvasRenderingContext2D,
  kind: ObstacleKind,
  x: number,
  y: number,
  w: number,
  h: number,
  tick = 0,
): void {
  if (kind === "box") {
    drawBox(ctx, x, y, w, h);
    return;
  }
  if (kind === "beam") {
    drawBeam(ctx, x, y, w, h);
    return;
  }
  drawBird(ctx, x, y, w, h, tick);
}

/** 木箱：泥土色箱体 + 交叉加固条 + 四角铆钉。 */
function drawBox(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
  rect(ctx, x, y, w, h, P.dirt);
  bevel(ctx, x, y, w, h, P.dirtHi, P.dirtDeep);
  strokeRect(ctx, x, y, w, h, P.dirtDeep);

  rect(ctx, x + 2, y + Math.floor(h / 2) - 1, w - 4, 2, P.dirtHi);
  rect(ctx, x + 2, y + Math.floor(h / 2) - 1, w - 4, 1, P.cream);
  rect(ctx, x + Math.floor(w / 2) - 1, y + 2, 2, h - 4, P.dirtDeep);

  rect(ctx, x + 2, y + 2, 1, 1, P.cream);
  rect(ctx, x + w - 3, y + 2, 1, 1, P.cream);
  rect(ctx, x + 2, y + h - 3, 1, 1, P.cream);
  rect(ctx, x + w - 3, y + h - 3, 1, 1, P.cream);
}

/**
 * 横梁：整根悬挂闸门，视觉和 collision box 完全一致（否则玩家会以为能翻过去）。
 *
 * - 上半段（y → bodyTop）画成吊挂的钢架，较暗，表示「跳不过去」
 * - 下半段 bodyTop → bottom 是 34px 厚的梁体（规格值），带竖向纹理
 * - 最底 6px 黄黑警示斜纹，提示「从这里钻过去」
 *
 * 碰撞盒就是这个整根柱子：底部留 18px 净空，站立 30 会撞、滑行 16 能过。
 */
function drawBeam(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
  const bottom = y + h;
  const bodyTop = bottom - BEAM_H;

  // 上半段：吊挂钢架（和碰撞盒一致的实心柱，颜色压暗一档）
  if (bodyTop > y) {
    rect(ctx, x, y, w, bodyTop - y, P.panel);
    rect(ctx, x, y, 1, bodyTop - y, P.line);
    rect(ctx, x + w - 1, y, 1, bodyTop - y, P.line);
    // 横向加强杆，越往上越稀，做出「往上延伸」的感觉
    for (let ry = y + 6; ry < bodyTop - 4; ry += 14) {
      rect(ctx, x + 1, ry, w - 2, 1, P.line);
      rect(ctx, x + 1, ry + 1, w - 2, 1, P.lineHi);
    }
    // 中间一根竖脊
    rect(ctx, x + Math.floor(w / 2), y, 1, bodyTop - y, P.line);
  }

  // 梁体（34px）：混凝土色 + 竖向纹理 + 上下边线
  rect(ctx, x, bodyTop, w, BEAM_H, P.panel2);
  for (let i = 1; i < w - 1; i += 5) rect(ctx, x + i, bodyTop + 2, 1, BEAM_H - 8, P.line);
  rect(ctx, x, bodyTop, w, 1, P.lineHi);
  rect(ctx, x, bodyTop, w, 2, P.panel);
  rect(ctx, x, bodyTop, 1, BEAM_H, P.lineHi);
  rect(ctx, x + w - 1, bodyTop, 1, BEAM_H, P.lineHi);

  // 底部警示斜纹：黄黑相间，提示「从这里钻过去」
  const bandH = 6;
  const bandY = bottom - bandH;
  rect(ctx, x, bandY, w, bandH, P.amber);
  for (let i = 0; i < w; i += 4) {
    rect(ctx, x + i, bandY, 2, bandH, P.void);
    rect(ctx, x + i + 1, bandY, 1, bandH, P.gold);
  }
  rect(ctx, x, bandY - 1, w, 1, P.void);

  // 梁下沿的一道暗影，强调那 18px 净空
  ctx.save();
  ctx.globalAlpha = 0.45;
  rect(ctx, x, bottom, w, 2, P.void);
  ctx.restore();
}

/** 飞鸟：紫色机体 + 拍动的翅膀 + 金喙。 */
function drawBird(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  tick: number,
): void {
  const up = ((tick % 2) + 2) % 2 === 0;
  const cx = x + Math.floor(w / 2);
  const cy = y + Math.floor(h / 2);

  if (up) {
    rect(ctx, cx - 1, y - 2, 4, 3, P.lav);
    rect(ctx, cx, y - 4, 3, 2, P.purple);
    rect(ctx, cx + 3, y - 1, 3, 1, P.lav);
  } else {
    rect(ctx, cx - 3, y + h - 2, 4, 2, P.lav);
    rect(ctx, cx - 1, y + h, 3, 2, P.purple);
    rect(ctx, cx - 5, y + h - 1, 2, 1, P.lav);
  }

  fillCircle(ctx, cx, cy, 3, P.purple);
  rect(ctx, x + 2, y + 4, w - 5, 2, P.purple);
  rect(ctx, cx - 1, cy - 2, 3, 2, P.lav);
  rect(ctx, x + w - 4, cy - 1, 1, 1, P.cream);
  rect(ctx, x + w - 2, cy, 2, 1, P.gold);
  rect(ctx, x + w - 2, cy + 1, 1, 1, P.amber);
}

/* ---------------- 金币 ---------------- */

/** 金币：中心 (cx,cy)、半径 4；spin 0–3 靠横向压缩做旋转。 */
export function drawCoin(ctx: CanvasRenderingContext2D, cx: number, cy: number, spin = 0): void {
  const px = Math.round(cx);
  const py = Math.round(cy);
  const squash = [1, 0.66, 0.3, 0.66][((spin % 4) + 4) % 4] ?? 1;
  const rx = Math.max(1, Math.round(COIN_R * squash));

  fillCircle(ctx, px, py, COIN_R, P.amber);
  if (squash > 0.5) {
    fillCircle(ctx, px, py, COIN_R - 1, P.gold);
    rect(ctx, px - 1, py - 2, 1, 2, P.white);
  }
  rect(ctx, px - rx, py, rx * 2, 1, P.amber);
}

/* ---------------- 特效 ---------------- */

/** 落地扬尘：左右两团小方块，life 从 1 衰减到 0。 */
export function drawDust(ctx: CanvasRenderingContext2D, x: number, groundY: number, life: number): void {
  const k = Math.max(0, Math.min(1, life));
  const spread = Math.round((1 - k) * 7);
  ctx.save();
  ctx.globalAlpha = k * 0.7;
  rect(ctx, x - spread - 3, groundY - 1, 3, 2, P.dirtHi);
  rect(ctx, x + spread, groundY - 1, 3, 2, P.dirtHi);
  rect(ctx, x - spread - 1, groundY - 3, 2, 2, P.grassHi);
  ctx.restore();
}

/** 高速时的速度线：几条横在玩家身后。 */
export function drawSpeedLines(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  count: number,
  phase: number,
): void {
  ctx.save();
  ctx.globalAlpha = 0.45;
  for (let i = 0; i < count; i += 1) {
    const offset = ((phase + i * 23) % 46) - 23;
    const ly = y + ((i * 17) % 40) - 20;
    const len = 5 + (i % 3) * 3;
    rect(ctx, x - 12 + offset, ly, len, 1, i % 2 === 0 ? P.lineHi : P.purple);
  }
  ctx.restore();
}

/** 撞击闪光：一圈放射线 + 中心亮点（k 从 1 衰减到 0）。 */
export function drawImpact(ctx: CanvasRenderingContext2D, cx: number, cy: number, k: number): void {
  const alpha = Math.max(0, Math.min(1, k));
  if (alpha <= 0) return;
  const reach = Math.round(4 + (1 - alpha) * 12);
  ctx.save();
  ctx.globalAlpha = alpha;
  rect(ctx, cx - reach, cy, reach * 2, 1, P.cream);
  rect(ctx, cx, cy - reach, 1, reach * 2, P.cream);
  rect(ctx, cx - Math.round(reach * 0.6), cy - Math.round(reach * 0.6), 2, 2, P.gold);
  rect(ctx, cx + Math.round(reach * 0.6) - 1, cy + Math.round(reach * 0.6) - 1, 2, 2, P.gold);
  ctx.restore();
}

/** 撞击飞散的碎块，固定六块（k 从 1 衰减到 0）。 */
export function drawShards(ctx: CanvasRenderingContext2D, cx: number, cy: number, k: number): void {
  const alpha = Math.max(0, Math.min(1, k));
  if (alpha <= 0) return;
  const spread = Math.round((1 - alpha) * 16);
  ctx.save();
  ctx.globalAlpha = alpha;
  rect(ctx, cx - spread, cy - spread, 2, 2, P.red);
  rect(ctx, cx + spread - 2, cy - spread, 2, 2, P.orange);
  rect(ctx, cx - spread, cy + spread - 2, 2, 2, P.gold);
  rect(ctx, cx + spread - 2, cy + spread - 2, 2, 2, P.cream);
  rect(ctx, cx + Math.round(spread * 0.7), cy - Math.round(spread * 0.7), 2, 2, P.mint);
  ctx.restore();
}
