/**
 * 环形陨石带的纯规则层：惯性飞船、屏幕环绕几何、陨石分档与波次曲线。
 *
 * 契约（docs/game-specs-vol03.md 第 24 节）要求导出
 * `TURN_RATE / THRUST / MAX_SHIP_SPEED / BULLET_SPEED / BULLET_MS /
 *  FIRE_COOLDOWN_MS / INVULN_MS / wrapX / wrapY / shipVelocity /
 *  splitAsteroid / scoreForSize / spawnCount / asteroidSpeed`。
 *
 * 这里**不碰 DOM、不调用 Math.random**：随机源一律由调用方注入（`rng`）。
 * 所有「每秒」常量都以 px/s 定义，用的时候自己乘 `dtMs / 1000`。
 */
import { clamp } from "@arcade/core";

/* ---------------- 场地 ---------------- */

/** 逻辑分辨率：宽固定 168，高 210（规格里的高屏机台）。 */
export const W = 168;
export const H = 210;

/* ---------------- 飞船 ---------------- */

/** 左右键转向：3.6 rad/s。 */
export const TURN_RATE = 3.6;
/** 推进加速度：110 px/s²，沿朝向。 */
export const THRUST = 110;
/** 速度上限 160 px/s；没有摩擦，松手保持原速。 */
export const MAX_SHIP_SPEED = 160;
/** 飞船碰撞半径：视觉约 10px，判定收窄到 4，擦边不判定为撞击。 */
export const SHIP_R = 4;

/* ---------------- 子弹 ---------------- */

/** 子弹基础速度 240 px/s（额外叠加飞船速度矢量的一半）。 */
export const BULLET_SPEED = 240;
/** 子弹存活 700ms。 */
export const BULLET_MS = 700;
/** 开火冷却 180ms。 */
export const FIRE_COOLDOWN_MS = 180;
/** 子弹继承飞船速度的比例。 */
export const BULLET_CARRY = 0.5;

/* ---------------- 规则 ---------------- */

/** 三条命。 */
export const START_LIVES = 3;
/** 被撞后无敌 1.2 秒。 */
export const INVULN_MS = 1200;
/** 清完一波后的喘息时间 1.6 秒。 */
export const WAVE_GAP_MS = 1600;

/* ---------------- 陨石 ---------------- */

export type AsteroidSize = "large" | "medium" | "small";

/** 三档半径：16 / 10 / 6。 */
export const ASTEROID_RADIUS: Record<AsteroidSize, number> = {
  large: 16,
  medium: 10,
  small: 6,
};

/** 得分：越打越碎越值钱（20 / 50 / 100）。 */
export const ASTEROID_SCORE: Record<AsteroidSize, number> = {
  large: 20,
  medium: 50,
  small: 100,
};

/** 陨石速度 36 + wave * 6，上限 90 px/s。 */
export const ASTEROID_SPEED_BASE = 36;
export const ASTEROID_SPEED_STEP = 6;
export const ASTEROID_SPEED_MAX = 90;

/** 每波 `6 + wave` 颗。 */
export const WAVE_BASE_COUNT = 6;

/** 新陨石落点离飞船至少这么远（加上自身半径），避免开局贴脸。 */
export const SAFE_SPAWN_DIST = 46;
/** 落点四边留白，避免一出现就半截在画面外。 */
export const SPAWN_MARGIN = 10;

/* ---------------- 小工具 ---------------- */

/** 毫秒 → 秒，负数 / NaN 按 0 处理。 */
function secondsOf(dtMs: number): number {
  return Math.max(0, Number.isFinite(dtMs) ? dtMs : 0) / 1000;
}

/** 随机源返回值夹到 [0, 1)，非有限值当 0。 */
function roll(rng: () => number): number {
  const raw = rng();
  if (!Number.isFinite(raw)) return 0;
  return clamp(raw, 0, 0.999999);
}

/** 角度归一化到 [0, 2π)。 */
export function normalizeAngle(angle: number): number {
  if (!Number.isFinite(angle)) return 0;
  const tau = Math.PI * 2;
  const wrapped = angle % tau;
  if (wrapped === 0) return 0;
  return wrapped < 0 ? wrapped + tau : wrapped;
}

/* ---------------- 屏幕环绕 ---------------- */

/** 横向环绕：x 落在 [0, W)。出界（含负值）从对面回来。 */
export function wrapX(x: number): number {
  if (!Number.isFinite(x)) return 0;
  const wrapped = x % W;
  if (wrapped === 0) return 0;
  return wrapped < 0 ? wrapped + W : wrapped;
}

/** 纵向环绕：y 落在 [0, H)。 */
export function wrapY(y: number): number {
  if (!Number.isFinite(y)) return 0;
  const wrapped = y % H;
  if (wrapped === 0) return 0;
  return wrapped < 0 ? wrapped + H : wrapped;
}

/**
 * 环绕空间里 a - b 的最短位移（结果落在 [-size/2, size/2]）。
 * 判定「跨接缝」的距离、以及把陨石推离飞船时都用它。
 */
export function wrapDelta(a: number, b: number, size: number): number {
  if (!Number.isFinite(a) || !Number.isFinite(b) || !Number.isFinite(size) || size <= 0) return 0;
  let delta = (a - b) % size;
  if (delta > size / 2) delta -= size;
  else if (delta < -size / 2) delta += size;
  return delta;
}

/** 环绕空间里两点的最短距离（跨接缝时比直线距离短）。 */
export function wrapDistance(ax: number, ay: number, bx: number, by: number): number {
  const dx = wrapDelta(ax, bx, W);
  const dy = wrapDelta(ay, by, H);
  return Math.hypot(dx, dy);
}

/** 环绕空间里的圆-圆相交（边缘正好相接算命中）。 */
export function circleHit(
  ax: number,
  ay: number,
  ar: number,
  bx: number,
  by: number,
  br: number,
): boolean {
  const dx = wrapDelta(ax, bx, W);
  const dy = wrapDelta(ay, by, H);
  const radius = Math.max(0, ar) + Math.max(0, br);
  return dx * dx + dy * dy <= radius * radius;
}

/* ---------------- 飞船物理 ---------------- */

/** 把速度矢量夹到上限；方向不变，只缩大小。 */
export function clampSpeed(
  vx: number,
  vy: number,
  max = MAX_SHIP_SPEED,
): { vx: number; vy: number } {
  const x = Number.isFinite(vx) ? vx : 0;
  const y = Number.isFinite(vy) ? vy : 0;
  const limit = Number.isFinite(max) ? Math.max(0, max) : 0;
  const speed = Math.hypot(x, y);
  if (speed <= limit || speed === 0) return { vx: x, vy: y };
  const scale = limit / speed;
  return { vx: x * scale, vy: y * scale };
}

/**
 * 一帧的速度迭代：`current`（可选，默认静止）沿 `angle` 累加推进加速度，
 * 再夹到 MAX_SHIP_SPEED。
 *
 * 不推进时**原样返回 current** —— 这就是「无摩擦惯性」：
 * 松手不减速，只有速度上限能拦住它。
 */
export function shipVelocity(
  angle: number,
  thrusting: boolean,
  dtMs: number,
  current: { vx: number; vy: number } = { vx: 0, vy: 0 },
): { vx: number; vy: number } {
  const cvx = Number.isFinite(current.vx) ? current.vx : 0;
  const cvy = Number.isFinite(current.vy) ? current.vy : 0;
  const seconds = secondsOf(dtMs);
  if (!thrusting || seconds <= 0) return clampSpeed(cvx, cvy);

  const heading = Number.isFinite(angle) ? angle : 0;
  const step = THRUST * seconds;
  return clampSpeed(cvx + Math.cos(heading) * step, cvy + Math.sin(heading) * step);
}

/**
 * 转向：dir 取 -1（左，逆时针）/ 0 / +1（右，顺时针），返回归一化后的角度。
 * `dtMs` 是毫秒，内部换算成秒再乘 TURN_RATE。
 */
export function turnAngle(angle: number, dir: number, dtMs: number, rate = TURN_RATE): number {
  const sign = Number.isFinite(dir) ? Math.sign(dir) : 0;
  const speed = Number.isFinite(rate) ? rate : 0;
  const base = Number.isFinite(angle) ? angle : 0;
  return normalizeAngle(base + sign * speed * secondsOf(dtMs));
}

/** 子弹速度：朝向 × 240 + 飞船速度的一半。 */
export function bulletVelocity(
  angle: number,
  shipVx = 0,
  shipVy = 0,
): { vx: number; vy: number } {
  const heading = Number.isFinite(angle) ? angle : 0;
  const inheritX = Number.isFinite(shipVx) ? shipVx * BULLET_CARRY : 0;
  const inheritY = Number.isFinite(shipVy) ? shipVy * BULLET_CARRY : 0;
  return {
    vx: Math.cos(heading) * BULLET_SPEED + inheritX,
    vy: Math.sin(heading) * BULLET_SPEED + inheritY,
  };
}

/* ---------------- 陨石规则 ---------------- */

/** 打碎一档后的碎片档位；small 不再分裂。 */
export function splitAsteroid(size: AsteroidSize): "medium" | "small" | null {
  if (size === "large") return "medium";
  if (size === "medium") return "small";
  return null;
}

/** 击碎一档的得分；未知档位按 0 处理（不会崩）。 */
export function scoreForSize(size: AsteroidSize): number {
  return ASTEROID_SCORE[size] ?? 0;
}

/** 每波陨石数：6 + wave（wave 夹在 1–99，HUD 只有两位）。 */
export function spawnCount(wave: number): number {
  const index = Math.max(1, Math.min(99, Math.floor(Number.isFinite(wave) ? wave : 1)));
  return WAVE_BASE_COUNT + index;
}

/** 陨石速度：36 + wave * 6，上限 90 px/s。 */
export function asteroidSpeed(wave: number): number {
  const index = Math.max(0, Math.floor(Number.isFinite(wave) ? wave : 0));
  return Math.min(ASTEROID_SPEED_MAX, ASTEROID_SPEED_BASE + index * ASTEROID_SPEED_STEP);
}

/**
 * 造一颗新陨石的落点与速度：位置与朝向都来自注入的 rng（同种子同结果）。
 *
 * `avoidX / avoidY`（可选，通常是飞船）给定时，落点会被推到离它
 * SAFE_SPAWN_DIST + 自身半径 之外，避免陨石出生就贴脸。
 */
export function makeAsteroid(
  size: AsteroidSize,
  rng: () => number,
  speed: number,
  avoidX = Number.NaN,
  avoidY = Number.NaN,
): { x: number; y: number; vx: number; vy: number } {
  const radius = ASTEROID_RADIUS[size] ?? 6;
  let x = SPAWN_MARGIN + roll(rng) * (W - SPAWN_MARGIN * 2);
  let y = SPAWN_MARGIN + roll(rng) * (H - SPAWN_MARGIN * 2);

  if (Number.isFinite(avoidX) && Number.isFinite(avoidY)) {
    const minDist = SAFE_SPAWN_DIST + radius;
    const dx = wrapDelta(x, avoidX, W);
    const dy = wrapDelta(y, avoidY, H);
    const distance = Math.hypot(dx, dy);
    if (distance < minDist) {
      // 沿「远离」方向推到安全距离外；完全重合时退化成向右推开。
      const unitX = distance > 0.0001 ? dx / distance : 1;
      const unitY = distance > 0.0001 ? dy / distance : 0;
      x = wrapX(avoidX + unitX * minDist);
      y = wrapY(avoidY + unitY * minDist);
    }
  }

  const heading = roll(rng) * Math.PI * 2;
  const magnitude = Math.max(0, Number.isFinite(speed) ? speed : 0);
  return {
    x,
    y,
    vx: Math.cos(heading) * magnitude,
    vy: Math.sin(heading) * magnitude,
  };
}
