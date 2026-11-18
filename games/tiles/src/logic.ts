/**
 * 别踩白块的核心数值与判定。
 *
 * 这里不碰 DOM / Canvas，所有规则都是纯函数，方便单测：
 * 判定窗口、速度曲线、连击倍率、生成间隔。
 */

/** 逻辑分辨率：4 条 42px 轨道。 */
export const W = 168;
export const H = 252;
export const LANES = 4;
export const LANE_W = 42;

/** 方块本体：两侧各留 3px，视觉上不贴轨道分隔线。 */
export const BLOCK_W = 36;
export const BLOCK_INSET = 3;
export const BLOCK_H = 34;

/** 底部可点区域：方块底边进入这 56px 才允许点，避免「点太早」。 */
export const HIT_ZONE = 56;
export const HIT_Y = H - HIT_ZONE;

/** 落地线：方块底边越过画布底边就算漏块。 */
export const FLOOR_Y = H;

/** 顶部 12px 是投放槽，方块从这里开始下落。 */
export const SPAWN_Y = 12;

/** 同时最多 3 块。 */
export const MAX_BLOCKS = 3;

/** 速度：90px/s 起，每命中 10 块 +12，封顶 300。 */
export const START_SPEED = 90;
export const SPEED_STEP = 12;
export const SPEED_CAP = 300;
export const BLOCKS_PER_LEVEL = 10;

/** 速度封顶时对应的等级，HUD 不再往上跳。 */
export const MAX_LEVEL = 1 + Math.ceil((SPEED_CAP - START_SPEED) / SPEED_STEP);

export interface Block {
  id: number;
  lane: number;
  /** 方块顶边的 y 坐标（逻辑像素）。 */
  y: number;
}

export const blockX = (lane: number): number => lane * LANE_W + BLOCK_INSET;

export const blockBottom = (block: Block): number => block.y + BLOCK_H;

/** 底边进入最后 56px、且还没落地，才是可点状态。 */
export function isHittable(block: Block): boolean {
  const bottom = blockBottom(block);
  return bottom >= HIT_Y && bottom < FLOOR_Y;
}

/** 底边越过画布底边：这一块漏了。 */
export const isMissed = (block: Block): boolean => blockBottom(block) >= FLOOR_Y;

/** 该轨道最下方（y 最大）的可点方块；没有就返回 null。 */
export function lowestHittable(blocks: readonly Block[], lane: number): Block | null {
  let found: Block | null = null;
  for (const block of blocks) {
    if (block.lane !== lane || !isHittable(block)) continue;
    if (!found || block.y > found.y) found = block;
  }
  return found;
}

/** 任意轨道里最靠下的可点方块（空格一键用）。 */
export function lowestHittableAny(blocks: readonly Block[]): Block | null {
  let found: Block | null = null;
  for (const block of blocks) {
    if (!isHittable(block)) continue;
    if (!found || block.y > found.y) found = block;
  }
  return found;
}

/** 速度等级：每命中 10 块升一级，封顶 MAX_LEVEL（19）。 */
export function speedLevelFor(hits: number): number {
  const level = 1 + Math.floor(Math.max(0, hits) / BLOCKS_PER_LEVEL);
  return Math.min(MAX_LEVEL, level);
}

/** 速度等级 → px/s，封顶 300。 */
export function speedForLevel(level: number): number {
  const steps = Math.max(0, level - 1);
  return Math.min(SPEED_CAP, START_SPEED + steps * SPEED_STEP);
}

export const speedForHits = (hits: number): number => speedForLevel(speedLevelFor(hits));

/**
 * 连击倍率：1 + floor(combo / 10)，最高 5。
 * 传入的是「这一块命中后的连击数」，所以第 10 块开始 ×2。
 */
export function multiplierFor(combo: number): number {
  return Math.min(5, 1 + Math.floor(Math.max(0, combo) / BLOCKS_PER_LEVEL));
}

/** 单块得分：10 × 倍率。 */
export const pointsFor = (combo: number): number => 10 * multiplierFor(combo);

/**
 * 方块生成间隔（秒）：速度等级越高越短，下限 0.22s。
 *
 * 规格给的 `max(0.22, 0.6 - speed * 0.01)` 若直接代入 px/s 会立刻压到
 * 0.22s（0.6 - 0.9 < 0），这里按等级线性缩短，保留「越快越密」的手感。
 */
export function spawnIntervalFor(level: number): number {
  return Math.max(0.22, 0.6 - Math.max(0, level - 1) * 0.02);
}
