/**
 * 像素入侵者纯规则层。
 *
 * 只处理常量、编队行进、波次速度与碰撞判定，不碰 DOM / Canvas，
 * 所以入侵者的数值曲线和边界行为都可以直接单测。
 */

export const FIELD_W = 168;
export const FIELD_H = 210;

/* ---------------- 玩家 ---------------- */

export const SHIP_W = 11;
export const SHIP_H = 7;
export const SHIP_Y = 194;
export const SHIP_SPEED = 120;
export const SHIP_MARGIN = 6;

/* ---------------- 敌阵 ---------------- */

export const ENEMY_COLS = 6;
export const ENEMY_ROWS = 4;
export const ENEMY_W = 11;
export const ENEMY_H = 7;
export const ENEMY_START_Y = 30;
export const ENEMY_STEP_X = 23;
export const ENEMY_STEP_Y = 14;
export const ENEMY_ORIGIN_X = 21;
export const ENEMY_DROP = 8;
export const ENEMY_MARGIN = 4;

/** 编队最右一列的右边缘（不含整体偏移）。 */
export const FORMATION_RIGHT = ENEMY_ORIGIN_X + (ENEMY_COLS - 1) * ENEMY_STEP_X + ENEMY_W;
/** 编队整体左右偏移的边界：左右各留 4px。 */
export const FORMATION_MIN_X = ENEMY_MARGIN - ENEMY_ORIGIN_X;
export const FORMATION_MAX_X = FIELD_W - ENEMY_MARGIN - FORMATION_RIGHT;

/* ---------------- 节奏 ---------------- */

export const WAVE_COUNT = 5;
export const WAVE_BONUS = 50;
/** 第一波的横向速度；之后每波 ×1.15。 */
export const MARCH_SPEED_BASE = 18;

export const PLAYER_FIRE_MS = 340;
export const PLAYER_BULLET_SPEED = 260;
export const ENEMY_BULLET_SPEED = 180;
export const PLAYER_BULLET_H = 4;
export const ENEMY_BULLET_H = 4;

export const INVULN_MS = 1200;
export const START_LIVES = 3;

/** 某一行敌机的分值：顶行最贵。 */
export function enemyScore(row: number): number {
  const table = [30, 20, 20, 10];
  return table[row] ?? 10;
}

/** 每波横向速度 +15%。 */
export function waveSpeed(wave: number): number {
  const w = Math.max(1, Math.floor(wave));
  return MARCH_SPEED_BASE * Math.pow(1.15, w - 1);
}

/** 敌方投弹间隔：1.2s 起，逐波递减，最低 0.5s。 */
export function waveFireInterval(wave: number): number {
  const w = Math.max(1, Math.min(WAVE_COUNT, Math.floor(wave)));
  return Math.max(500, 1200 - (w - 1) * 175);
}

/** 编队某一列的左边缘。 */
export function enemyX(col: number, offsetX: number): number {
  return ENEMY_ORIGIN_X + col * ENEMY_STEP_X + offsetX;
}

/** 编队某一行的上边缘。 */
export function enemyY(row: number, offsetY: number): number {
  return ENEMY_START_Y + row * ENEMY_STEP_Y + offsetY;
}

export interface MarchState {
  /** 编队整体的左右偏移。 */
  offset: number;
  /** 当前方向：1 向右，-1 向左。 */
  dir: -1 | 1;
}

/**
 * 编队整体横移一步（原地修改 state，避免每帧新建对象）。
 *
 * 撞边时夹在边界上并反向，返回 true 表示需要下压 8px。
 * 夹在边界上而不是原路反弹，保证编队永远不会越出左右安全区。
 */
export function marchStep(
  state: MarchState,
  step: number,
  min = FORMATION_MIN_X,
  max = FORMATION_MAX_X,
): boolean {
  if (!(step > 0) || max <= min) return false;

  const next = state.offset + state.dir * step;

  if (next <= min) {
    state.offset = min;
    state.dir = 1;
    return true;
  }
  if (next >= max) {
    state.offset = max;
    state.dir = -1;
    return true;
  }

  state.offset = next;
  return false;
}

/** 飞船中心 x 的合法范围。 */
export function clampShipX(x: number): number {
  return Math.min(FIELD_W - SHIP_MARGIN, Math.max(SHIP_MARGIN, x));
}

/**
 * 扫掠式 AABB 命中：子弹从 fromY 移动到 toY，跨度可能一帧超过敌机高度。
 *
 * bulletX 是 1px 子弹的左边缘；target 是实体左上角与尺寸。
 * 先比 x 区间，再比「扫过的 y 区间 + 子弹高度」，避免高速穿透。
 */
export function sweptHit(
  bulletX: number,
  fromY: number,
  toY: number,
  targetX: number,
  targetY: number,
  targetW = ENEMY_W,
  targetH = ENEMY_H,
  bulletH = PLAYER_BULLET_H,
): boolean {
  if (bulletX < targetX || bulletX >= targetX + targetW) return false;

  const top = Math.min(fromY, toY);
  const bottom = Math.max(fromY, toY) + bulletH;
  return bottom >= targetY && top <= targetY + targetH;
}

/** 命中率（四舍五入到百分比）。 */
export function accuracy(hits: number, shots: number): number {
  if (shots <= 0) return 0;
  return Math.round((hits / shots) * 100);
}
