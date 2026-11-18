/**
 * 陨石雨的纯逻辑：难度曲线、生存计分、圆-矩形碰撞、对象池。
 * 全部无 DOM 依赖，单测可以直接引用。
 */
import { clamp, lerp } from "@arcade/core";

export const W = 168;
export const H = 210;

/** 一局 45 秒。 */
export const ROUND_MS = 45_000;
/** 生存分每 100ms 结一次，每跳 +2（45 秒合计 900）。 */
export const TICK_MS = 100;
export const MAX_TICKS = ROUND_MS / TICK_MS;
export const SURVIVAL_POINTS = 2;

/** 擦身 +15；结算时每个没用掉的护盾 +30。 */
export const GRAZE_POINTS = 15;
export const SHIELD_BONUS = 30;

/** 护盾最多囤 3 个，每 9 秒掉一个。 */
export const MAX_SHIELDS = 3;
export const SHIELD_INTERVAL_MS = 9_000;

/** 对象池上限。 */
export const MAX_METEORS = 60;
export const MAX_PARTICLES = 120;
export const MAX_DROPS = 4;

/** 飞船 9×9；命中箱缩到 7×7，擦身按整机轮廓算，手感更宽容。 */
export const SHIP_SIZE = 9;
export const SHIP_HITBOX = 7;
export const SHIP_SPEED = 132;
export const GRAZE_RANGE = 6;

/** 陨石下落速度 60 → 160 px/s，刷怪间隔 560 → 260ms。 */
export const START_SPEED = 60;
export const MAX_SPEED = 160;
export const START_INTERVAL = 560;
export const MIN_INTERVAL = 260;

/** 陨石直径 5–11px。 */
export const METEOR_MIN_DIAMETER = 5;
export const METEOR_MAX_DIAMETER = 11;

/** 每个 15 秒提一次速，用于提示与音效。 */
export const SPEED_STAGE_MS = 15_000;

export interface Meteor {
  alive: boolean;
  x: number;
  y: number;
  r: number;
  vy: number;
  spin: number;
  spinSpeed: number;
  /** 0–3，决定岩石配色。 */
  kind: number;
  /** 每颗陨石只计一次擦身分。 */
  grazed: boolean;
}

export interface Particle {
  alive: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  size: number;
  star: boolean;
  color: string;
}

export interface ShieldDrop {
  alive: boolean;
  x: number;
  y: number;
  vy: number;
  phase: number;
}

/** 当前时刻的陨石速度（线性 60 → 160 px/s）。 */
export function meteorSpeedAt(elapsedMs: number): number {
  return lerp(START_SPEED, MAX_SPEED, clamp(elapsedMs / ROUND_MS, 0, 1));
}

/** 当前时刻的刷怪间隔（线性 560 → 260ms）。 */
export function spawnIntervalAt(elapsedMs: number): number {
  return lerp(START_INTERVAL, MIN_INTERVAL, clamp(elapsedMs / ROUND_MS, 0, 1));
}

/** 速度阶段：0（0–15 秒）、1（15–30 秒）、2（30 秒之后）。 */
export function speedStageFor(elapsedMs: number): number {
  if (elapsedMs >= SPEED_STAGE_MS * 2) return 2;
  if (elapsedMs >= SPEED_STAGE_MS) return 1;
  return 0;
}

/** 已经结算过多少个 100ms 生存跳；45 秒封顶。 */
export function survivalTicksFor(elapsedMs: number): number {
  if (!Number.isFinite(elapsedMs) || elapsedMs <= 0) return 0;
  return clamp(Math.floor(elapsedMs / TICK_MS), 0, MAX_TICKS);
}

/** 结算分：生存跳 + 擦身 + 未用护盾，参数越界会被夹住。 */
export function scoreFor(ticks: number, grazes: number, unusedShields: number): number {
  const t = clamp(Math.floor(ticks), 0, MAX_TICKS);
  const g = Math.max(0, Math.floor(grazes));
  const s = clamp(Math.floor(unusedShields), 0, MAX_SHIELDS);
  return t * SURVIVAL_POINTS + g * GRAZE_POINTS + s * SHIELD_BONUS;
}

/** 随机一颗陨石的半径：直径 5/6/…/11px，对应 2.5–5.5。 */
export function meteorRadius(random: () => number = Math.random): number {
  const steps = METEOR_MAX_DIAMETER - METEOR_MIN_DIAMETER + 1;
  const roll = clamp(random(), 0, 0.999999);
  return (METEOR_MIN_DIAMETER + Math.floor(roll * steps)) / 2;
}

/** 飞船中心可活动的范围：左右各留 5px，上下各留 8px。 */
export function clampShipX(x: number): number {
  const half = SHIP_SIZE / 2;
  return clamp(x, half + 0.5, W - half - 0.5);
}

export function clampShipY(y: number): number {
  const half = SHIP_SIZE / 2;
  return clamp(y, half + 3.5, H - half - 3.5);
}

/** 点到矩形的最短距离（在矩形内为 0）。 */
export function pointRectDistance(
  px: number,
  py: number,
  rx: number,
  ry: number,
  rw: number,
  rh: number,
): number {
  const dx = px < rx ? rx - px : px > rx + rw ? px - (rx + rw) : 0;
  const dy = py < ry ? ry - py : py > ry + rh ? py - (ry + rh) : 0;
  return Math.sqrt(dx * dx + dy * dy);
}

/** 圆与矩形是否相交（圆-矩形近似碰撞）。 */
export function circleRectOverlap(
  cx: number,
  cy: number,
  r: number,
  rx: number,
  ry: number,
  rw: number,
  rh: number,
): boolean {
  return pointRectDistance(cx, cy, rx, ry, rw, rh) <= r;
}

/** 陨石是否命中飞船的 7×7 命中箱。 */
export function hitsShip(
  meteorX: number,
  meteorY: number,
  radius: number,
  shipX: number,
  shipY: number,
): boolean {
  const half = SHIP_HITBOX / 2;
  return circleRectOverlap(meteorX, meteorY, radius, shipX - half, shipY - half, SHIP_HITBOX, SHIP_HITBOX);
}

/** 擦身：陨石边缘离 9×9 飞船轮廓小于 6px，且还没撞上。 */
export function isGraze(
  meteorX: number,
  meteorY: number,
  radius: number,
  shipX: number,
  shipY: number,
): boolean {
  const half = SHIP_SIZE / 2;
  const distance = pointRectDistance(meteorX, meteorY, shipX - half, shipY - half, SHIP_SIZE, SHIP_SIZE);
  return distance > radius && distance - radius < GRAZE_RANGE;
}

export function createMeteorPool(): Meteor[] {
  const pool: Meteor[] = [];
  for (let i = 0; i < MAX_METEORS; i += 1) {
    pool.push({
      alive: false,
      x: 0,
      y: 0,
      r: 3,
      vy: 0,
      spin: 0,
      spinSpeed: 0,
      kind: 0,
      grazed: false,
    });
  }
  return pool;
}

export function createParticlePool(): Particle[] {
  const pool: Particle[] = [];
  for (let i = 0; i < MAX_PARTICLES; i += 1) {
    pool.push({
      alive: false,
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      life: 0,
      max: 0,
      size: 1,
      star: false,
      color: "",
    });
  }
  return pool;
}

export function createShieldPool(): ShieldDrop[] {
  const pool: ShieldDrop[] = [];
  for (let i = 0; i < MAX_DROPS; i += 1) {
    pool.push({ alive: false, x: 0, y: 0, vy: 0, phase: 0 });
  }
  return pool;
}

/** 粒子池步进：寿命递减、轻微下坠，死了立刻回池。 */
export function stepParticles(pool: readonly Particle[], dt: number): void {
  const seconds = dt / 1000;
  for (const p of pool) {
    if (!p.alive) continue;
    p.life -= dt;
    if (p.life <= 0) {
      p.alive = false;
      continue;
    }
    p.x += p.vx * seconds;
    p.y += p.vy * seconds;
    p.vy += 60 * seconds;
  }
}
