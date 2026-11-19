import { P, rect } from "@arcade/core";

/**
 * 环形陨石带专属像素素材：可旋转的飞船、三档陨石、子弹与星点。
 *
 * 全部颜色从 `P.*` 取；不创建 canvas、不碰 DOM、不使用外部图片。
 * 所有图形都按整数像素落笔（旋转用局部坐标采样，不是 canvas 的 rotate），
 * 保证和其它游戏的像素颗粒大小一致。
 */

export type AsteroidKind = "large" | "medium" | "small";

/** 三档陨石的配色：机体 / 高光 / 坑洞。 */
const ASTEROID_COLORS: Record<AsteroidKind, { body: string; glint: string; crater: string }> = {
  large: { body: P.purple, glint: P.lav, crater: P.night },
  medium: { body: P.dirt, glint: P.dirtHi, crater: P.void },
  small: { body: P.amber, glint: P.gold, crater: P.redDeep },
};

/** 位置哈希：给陨石一个稳定的「长相」，静止时不会闪。 */
function hashOf(x: number, y: number): number {
  return (Math.abs(Math.floor(x)) * 73856093) ^ (Math.abs(Math.floor(y)) * 19349663);
}

/**
 * 一颗陨石：实心圆 + 右下沉边 + 左上高光 + 2–4 个坑洞。
 *
 * 用逐行 scandline 画圆（不用 canvas 的 arc），边缘保留像素锯齿感；
 * 坑洞位置来自 (坐标, variant) 的哈希，因此同一颗陨石每帧长得一模一样。
 */
export function drawAsteroid(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  radius: number,
  kind: AsteroidKind,
  variant = 0,
): void {
  const colors = ASTEROID_COLORS[kind] ?? ASTEROID_COLORS.large;
  const px = Math.round(cx);
  const py = Math.round(cy);
  const r = Math.max(2, Math.round(radius));
  const seed = (hashOf(px, py) ^ (Math.abs(Math.floor(variant)) * 2654435761)) >>> 0;

  // 机体：逐行扫圆。
  for (let dy = -r; dy <= r; dy += 1) {
    const half = Math.floor(Math.sqrt(Math.max(0, r * r - dy * dy)));
    if (half <= 0) continue;
    const color = dy > r * 0.45 ? colors.crater : colors.body;
    rect(ctx, px - half, py + dy, half * 2 + 1, 1, color);
  }

  // 左上高光：一条短弧。
  const litRows = Math.max(1, Math.round(r * 0.5));
  for (let dy = -r + 1; dy < -r + litRows; dy += 1) {
    const half = Math.floor(Math.sqrt(Math.max(0, r * r - dy * dy)));
    if (half <= 1) continue;
    rect(ctx, px - half + 1, py + dy, Math.max(1, Math.round(half * 0.6)), 1, colors.glint);
  }

  // 坑洞：按哈希撒 2–4 个小方块，位置限制在内圈。
  const craters = 2 + (seed % 3);
  const craterSize = r >= 12 ? 3 : 2;
  for (let i = 0; i < craters; i += 1) {
    const angle = (((seed >>> (i * 5 + 3)) & 0xff) / 255) * Math.PI * 2;
    const distance = r * (0.18 + (((seed >>> (i * 7 + 1)) & 0xff) / 255) * 0.44);
    const ox = px + Math.round(Math.cos(angle) * distance);
    const oy = py + Math.round(Math.sin(angle) * distance);
    rect(ctx, ox, oy, craterSize, craterSize, colors.crater);
  }
}

/** 一颗子弹：1px 亮头 + 沿飞行方向拖出的两格尾迹。 */
export function drawBullet(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  vx: number,
  vy: number,
): void {
  const speed = Math.hypot(vx, vy);
  const ux = speed > 0.0001 ? vx / speed : 1;
  const uy = speed > 0.0001 ? vy / speed : 0;
  const px = Math.round(x);
  const py = Math.round(y);

  rect(ctx, px, py, 1, 1, P.white);
  for (let i = 1; i <= 2; i += 1) {
    rect(ctx, px - Math.round(ux * i), py - Math.round(uy * i), 1, 1, P.cream);
  }
}

/**
 * 飞船机身尺寸（局部坐标，机头朝 **+x**）。
 *
 * 局部 +x 必须等于角度 0 时的飞行方向：逻辑层用 `cos(angle) / sin(angle)`
 * 当朝向，屏幕 y 轴向下，所以角度 0 = 向右飞、角度 +π/2 = 向下飞。
 */
const SHIP_NOSE = 6;
const SHIP_BACK = 4;
const SHIP_HALF = 4;

/**
 * 飞船：朝 `angle` 旋转的实心三角机身 + 座舱点 + 推进尾焰。
 *
 * 旋转靠「局部坐标采样 → 旋转 → 落笔」，而不是 canvas 变换：
 * 这样像素始终对齐整数格，和其它游戏的颗粒感一致。
 */
export function drawShip(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  angle: number,
  thrusting: boolean,
  clockMs: number,
): void {
  const px = Math.round(x);
  const py = Math.round(y);
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);

  /** 局部坐标（+x 向前，+y 向右舷）→ 屏幕坐标的落点。 */
  const plot = (lx: number, ly: number, color: string): void => {
    const wx = Math.round(px + lx * cos - ly * sin);
    const wy = Math.round(py + lx * sin + ly * cos);
    rect(ctx, wx, wy, 1, 1, color);
  };

  // 尾焰先画（机身会盖住焰根）；长度两帧交替，产生抖动感。
  if (thrusting) {
    const length = Math.floor(clockMs / 70) % 2 === 0 ? 6 : 4;
    for (let back = SHIP_BACK; back <= SHIP_BACK + length; back += 1) {
      const spread = back - SHIP_BACK < 2 ? 1 : 0;
      const color = back < SHIP_BACK + 2 ? P.white : back < SHIP_BACK + 4 ? P.amber : P.orange;
      for (let ly = -spread; ly <= spread; ly += 1) plot(-back, ly, color);
    }
  }

  // 机身：沿前向逐列填充三角，尾部留一个 V 形缺口。
  for (let lx = -SHIP_BACK; lx <= SHIP_NOSE; lx += 1) {
    const t = (SHIP_NOSE - lx) / (SHIP_NOSE + SHIP_BACK);
    const half = SHIP_HALF * t;
    const notch = lx < -SHIP_BACK + 2 ? (-SHIP_BACK + 2 - lx) * 1.5 : 0;
    const edge = lx >= SHIP_NOSE - 1 ? 0.6 : half;
    for (let ly = -Math.floor(edge); ly <= Math.floor(edge); ly += 1) {
      if (Math.abs(ly) < notch) continue;
      const color = ly < -half * 0.4 ? P.cream : ly > half * 0.4 ? P.grass : P.mint;
      plot(lx, ly, color);
    }
  }

  // 座舱：机头后一格的高亮点。
  plot(Math.round(SHIP_NOSE * 0.35), 0, P.white);
}

/** 爆炸 / 尾迹粒子：单像素方块，透明度由调用方设置。 */
export function drawSpark(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  color: string,
): void {
  rect(ctx, x, y, Math.max(1, Math.round(size)), Math.max(1, Math.round(size)), color);
}

/** 静态星点：坐标由调用方一次算好，这里只负责画。 */
export function drawStar(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  bright: boolean,
): void {
  rect(ctx, x, y, 1, 1, bright ? P.lav : P.line);
}
