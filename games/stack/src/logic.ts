/**
 * 像素堆塔的纯规则层：摆动、裁剪、完美判定、计分、摄像机。
 *
 * 不碰 DOM / Canvas，也不自己取随机数：
 * 需要随机初始相位时由调用方注入 rng，单测可以完全复现。
 */

/** 逻辑画布尺寸（和 meta.size 一致）。 */
export const W = 168;
export const H = 210;

/** 首块宽度，同时也是宽度上限（完美回赠不会超过它）。 */
export const START_WIDTH = 96;
export const MAX_WIDTH = START_WIDTH;

/** 每块的高度。 */
export const BLOCK_H = 14;

/**
 * 地面横线：规格里的「塔从底部 (0, 178) 开始」，
 * 178 就是首块底边（也就是塔与地面的接触线），x 从居中算。
 */
export const GROUND_Y = 178;
/** 首块顶边的世界纵坐标：塔从这里往上长。 */
export const BASE_TOP = GROUND_Y - BLOCK_H;

/** 新块悬停的屏幕纵坐标（吊臂正下方）。 */
export const DROP_Y = 26;

/** 塔身高过 100px 后摄像机开始跟随，并把塔顶固定在 CAMERA_LINE。 */
export const CAMERA_THRESHOLD = 100;
export const CAMERA_LINE = BASE_TOP - CAMERA_THRESHOLD;

/** 完美容差（px）：偏移绝对值不超过它就算完美。 */
export const PERFECT_TOLERANCE = 3;
/** 完美时回赠的宽度（px）。 */
export const PERFECT_REFUND = 4;

/** 摆动角速度 1.6 → 4.2 rad/s，堆到 SPEED_RAMP_FLOOR 层之后封顶。 */
export const SPEED_START = 1.6;
export const SPEED_MAX = 4.2;
export const SPEED_RAMP_FLOOR = 20;

/** 摆动轨道左右各留 2px，避免方块贴住画布边缘。 */
export const RAIL_MARGIN = 2;

/** 每成功一层的底分与每级连击的加成。 */
export const LAYER_POINTS = 10;
export const COMBO_POINTS = 5;

export interface Rect {
  x: number;
  w: number;
}

export interface CropResult {
  /** 保留下来的那块（重叠区间）。 */
  x: number;
  w: number;
  /** 落点相对上一块中心的偏移，正数偏右。 */
  offset: number;
  /** 被裁掉的部分，最多两块（左悬空 / 右悬空各一块）。 */
  cuts: Rect[];
}

const finite = (value: number, fallback = 0): number =>
  Number.isFinite(value) ? value : fallback;

/** 当前层数对应的摆动角速度（rad/s），单调不减并封顶在 SPEED_MAX。 */
export function speedForFloor(floor: number): number {
  const layers = Math.max(0, finite(floor));
  const t = Math.min(layers, SPEED_RAMP_FLOOR) / SPEED_RAMP_FLOOR;
  return SPEED_START + (SPEED_MAX - SPEED_START) * t;
}

/**
 * 正弦摆动位移：返回相对轨道中心的偏移，取值恒在 [-range, range]。
 * t 是这一块的摆动时间（秒），speed 是角速度（rad/s）。
 */
export function swingX(t: number, speed: number, range: number): number {
  const amplitude = Math.abs(finite(range));
  if (amplitude === 0) return 0;
  const seconds = finite(t);
  const omega = finite(speed);
  if (omega === 0) return 0;
  return Math.sin(seconds * omega) * amplitude;
}

/** 给定宽度的方块在轨道上的摆动半径。 */
export function railRange(width: number): number {
  const usable = Math.max(0, finite(width));
  const half = Math.max(0, (W - Math.min(usable, W)) / 2);
  return Math.max(0, half - RAIL_MARGIN);
}

/** 摆动轨道的中心（方块 left 坐标）。 */
export function railCenterX(width: number): number {
  return (W - Math.max(0, finite(width))) / 2;
}

/** 摆动半径上限：方块变窄之后不至于横穿整个画面，保留对位空间。 */
export const MAX_SWING_RANGE = 60;

/** 给定宽度实际使用的摆动半径：不越出画布，也不超过上限。 */
export function swingRangeFor(width: number): number {
  return Math.min(railRange(width), MAX_SWING_RANGE);
}

/**
 * 裁掉超出的部分：返回保留块、落点偏移和被切下来的碎块。
 * 偏移按两块的中心差计算；游戏里新旧块等宽，所以等价于左边差。
 */
export function cropOverlap(prevX: number, prevW: number, x: number, w: number): CropResult {
  const px = finite(prevX);
  const pw = Math.max(0, finite(prevW));
  const bx = finite(x);
  const bw = Math.max(0, finite(w));

  const left = Math.max(px, bx);
  const right = Math.min(px + pw, bx + bw);
  const overlap = Math.max(0, right - left);
  const offset = bx + bw / 2 - (px + pw / 2);

  const cuts: Rect[] = [];
  if (overlap > 0) {
    if (bx < left) cuts.push({ x: bx, w: left - bx });
    if (bx + bw > right) cuts.push({ x: right, w: bx + bw - right });
  } else if (bw > 0) {
    // 完全错开：整块都是碎片。
    cuts.push({ x: bx, w: bw });
  }

  return { x: left, w: overlap, offset, cuts };
}

/** 完美判定：落点偏移绝对值 ≤ 3px。 */
export function isPerfect(offset: number): boolean {
  if (!Number.isFinite(offset)) return false;
  return Math.abs(offset) <= PERFECT_TOLERANCE;
}

/** 完全落空（重叠为 0）：塔塌了。 */
export function isCollapsed(crop: { w: number }): boolean {
  return !(crop.w > 0);
}

/**
 * 完美后回赠宽度：在保留下来的这块基础上 +4，最多回到 START_WIDTH（96）。
 * 回赠长在左边缘上，右边缘不动 —— 和「保留右边缘」的判定一致。
 */
export function refundWidth(width: number): number {
  const safe = Math.max(0, Math.min(finite(width), MAX_WIDTH));
  return Math.min(MAX_WIDTH, safe + PERFECT_REFUND);
}

/** 每成功一层的得分：10 + 连击 × 5。契约里的 floor 预留给后续难度加成。 */
export function scoreForFloor(_floor: number, combo: number): number {
  const streak = Math.max(0, Math.floor(finite(combo)));
  return LAYER_POINTS + streak * COMBO_POINTS;
}

/**
 * 摄像机下移量：塔顶高于 CAMERA_LINE 之后整体下移，
 * 让塔顶停在 CAMERA_LINE。stackTop 越小（塔越高）返回值越大，永不倒退。
 */
export function cameraFor(stackTop: number): number {
  const top = finite(stackTop, BASE_TOP);
  const shift = CAMERA_LINE - top;
  return shift > 0 ? shift : 0;
}

/**
 * 新块的随机初始相位（0–2π）。
 * 从摆动轨道上的随机点出生，避免「一开局就按」必然完美。
 */
export function spawnPhase(rng: () => number = Math.random): number {
  const roll = finite(rng(), 0);
  const safe = Math.min(Math.max(roll, 0), 0.999999);
  return safe * Math.PI * 2;
}
