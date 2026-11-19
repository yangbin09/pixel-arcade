/**
 * 像素抓娃娃的纯规则层：爪子移动、抓取概率、奖品布局、计分。
 *
 * 不碰 DOM / Canvas，随机源由调用方注入（默认 Math.random），
 * 所以「抓取率曲线」「奖品永不重叠」「对准时选中最近奖品」都能直接单测。
 *
 * 核心设计：抓取率是「水平对准度」的平滑函数，不是纯随机 ——
 * offset 0 时 0.92，offset ≥ 24 时 0.06，中间线性下降；
 * 连抓每次 +0.04，封顶 0.96。
 */

/** 逻辑画布尺寸（和 meta.size 一致）。 */
export const W = 168;
export const H = 210;

/** 爪子中心可以移动的横向范围。 */
export const CLAW_MIN = 12;
export const CLAW_MAX = 156;

/** 爪子悬停线，以及奖品所在的货架线。 */
export const CLAW_Y = 24;
export const SHELF_Y = 170;

/** 钩子行程：顶在爪位，底在货架上方一点，正好咬住奖品中段。 */
export const HOOK_TOP = CLAW_Y;
export const HOOK_BOTTOM = 154;

/** 水平速度：松手为 0，按住就是 90px/s（规格里的键盘手感）。 */
export const CLAW_SPEED = 90;

/** 钩子落 / 升速度，闭合动作时长与结算停顿。 */
export const HOOK_DESCENT_SPEED = 150;
export const HOOK_LIFT_SPEED = 170;
export const CLOSE_MS = 220;
export const SETTLE_MS = 420;

/** 一局的机会数。 */
export const TRIES = 10;

/** 奖品货架的边距、每层数量与宽度区间（宽度 20–26）。 */
export const EDGE = 8;
export const PRIZE_COUNT = 5;
export const PRIZE_MIN_W = 20;
export const PRIZE_MAX_W = 26;

/** 抓取率曲线：正中 0.92 → 偏 24px 只剩 0.06，中间线性。 */
export const CHANCE_AT_CENTER = 0.92;
export const CHANCE_AT_EDGE = 0.06;
export const CHANCE_OFFSET_MAX = 24;
export const STREAK_BONUS = 0.04;
export const CHANCE_CAP = 0.96;

/** 连抓每级额外给分。 */
export const STREAK_POINTS = 5;

export type TierKey = "small" | "mid" | "big";

export interface PrizeTier {
  key: TierKey;
  /** 抓到的底分。 */
  points: number;
  /** 抽档权重（三档合计 100）。 */
  weight: number;
  /** 该档奖品的宽度（20–26）。 */
  w: number;
  /** 该档奖品的高度；底部对齐货架线。 */
  h: number;
}

/** 三档奖品：小 60% / 中 30% / 大 10%。 */
export const PRIZE_TIERS: readonly PrizeTier[] = [
  { key: "small", points: 10, weight: 60, w: 20, h: 15 },
  { key: "mid", points: 25, weight: 30, w: 23, h: 19 },
  { key: "big", points: 60, weight: 10, w: 26, h: 23 },
];

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Prize extends Box {
  /** 布局内的稳定编号，用来标记「被盯上的那个」。 */
  id: number;
  tier: TierKey;
  points: number;
}

const finite = (value: number, fallback = 0): number =>
  Number.isFinite(value) ? value : fallback;

const clampNumber = (value: number, min: number, max: number): number =>
  value < min ? min : value > max ? max : value;

/* ---------------- 奖品档位 ---------------- */

/** 按 key 取档位定义；未知 key 退回最小档。 */
export function tierOf(key: TierKey): PrizeTier {
  for (const tier of PRIZE_TIERS) {
    if (tier.key === key) return tier;
  }
  return PRIZE_TIERS[0] as PrizeTier;
}

/** 三档权重总和（正常是 100，这里算出来方便校验）。 */
export function totalWeight(): number {
  return PRIZE_TIERS.reduce((sum, tier) => sum + tier.weight, 0);
}

/**
 * 按权重抽一档奖品。rng 会被夹进 [0, 1)，保证任何随机源都落在三档之内。
 * 权重 60 / 30 / 10，所以 rng 值越大档位越大。
 */
export function rollTier(rng: () => number = Math.random): PrizeTier {
  const total = totalWeight();
  const roll = clampNumber(finite(rng(), 0.5), 0, 0.999999) * total;
  let rest = roll;
  for (const tier of PRIZE_TIERS) {
    rest -= tier.weight;
    if (rest < 0) return tier;
  }
  return PRIZE_TIERS[PRIZE_TIERS.length - 1] as PrizeTier;
}

/* ---------------- 抓取概率 ---------------- */

/**
 * 抓取概率：offset 是「爪子中心到奖品中心」的水平距离。
 *
 * - offset 0 → 0.92；offset ≥ 24 → 0.06；中间严格线性；
 * - 连抓每级 +0.04（streak 是已经连抓到的次数），最终封顶 0.96；
 * - 返回值永远落在 [0.06, 0.96]，基础值落在 [0.06, 0.92]。
 *
 * 对 NaN / Infinity 也稳定：NaN 当作最差瞄准，负数取绝对值。
 */
export function grabChance(offset: number, streak = 0): number {
  const distance = Math.abs(finite(offset, CHANCE_OFFSET_MAX));
  const chain = Math.max(0, Math.floor(finite(streak)));

  let base: number;
  if (distance <= 0) base = CHANCE_AT_CENTER;
  else if (distance >= CHANCE_OFFSET_MAX) base = CHANCE_AT_EDGE;
  else {
    const t = distance / CHANCE_OFFSET_MAX;
    base = CHANCE_AT_CENTER - (CHANCE_AT_CENTER - CHANCE_AT_EDGE) * t;
  }

  const total = base + STREAK_BONUS * chain;
  return total >= CHANCE_CAP ? CHANCE_CAP : total;
}

/**
 * 用一次随机掷点判定这一钩是否抓住。
 * roll 是 [0, 1) 的随机数；roll 恰好等于概率时不通过。
 */
export function resolveGrab(offset: number, streak: number, roll: number): boolean {
  const chance = grabChance(offset, streak);
  return clampNumber(finite(roll, 1), 0, 1) < chance;
}

/* ---------------- 奖品布局 ---------------- */

/** 矩形是否重叠；零面积视为不重叠。 */
export function overlap(a: Box, b: Box): boolean {
  if (!(a.w > 0) || !(a.h > 0) || !(b.w > 0) || !(b.h > 0)) return false;
  return (
    a.x < b.x + b.w &&
    b.x < a.x + a.w &&
    a.y < b.y + b.h &&
    b.y < a.y + a.h
  );
}

/**
 * 在货架线上摆一层奖品（每局 PRIZE_COUNT 个），保证两两不重叠。
 *
 * 做法：先按权重抽档位得到每档固定宽度，再把剩余空间平分成
 * （数量 + 1）条缝，余数补给右侧的缝 —— 于是从左到右顺序摆放，
 * 每条缝 ≥ 0，永远不会压在一起；总宽不够时从尾部丢奖品。
 */
export function layoutPrizes(width: number = W, rng: () => number = Math.random): Prize[] {
  const field = Math.max(0, finite(width, W));
  const usable = field - EDGE * 2;
  if (usable <= 0) return [];

  const picks: PrizeTier[] = [];
  for (let index = 0; index < PRIZE_COUNT; index += 1) picks.push(rollTier(rng));

  // 窄画布兜底：至少留 1px 缝，仍不够就丢掉尾部奖品。
  while (picks.length > 0) {
    const total = picks.reduce((sum, tier) => sum + tier.w, 0);
    if (total + picks.length + 1 <= usable) break;
    picks.pop();
  }
  if (picks.length === 0) return [];

  const count = picks.length;
  const total = picks.reduce((sum, tier) => sum + tier.w, 0);
  const slots = count + 1;
  const free = usable - total;
  const baseGap = Math.floor(free / slots);
  const extra = free - baseGap * slots;
  // 余数补给靠右的缝，保证整体仍然贴着右内边距。
  const gapOf = (index: number): number =>
    baseGap + (index >= slots - extra ? 1 : 0);

  const prizes: Prize[] = [];
  let cursor = EDGE;
  for (let index = 0; index < count; index += 1) {
    cursor += gapOf(index);
    const tier = picks[index] as PrizeTier;
    prizes.push({
      id: index,
      tier: tier.key,
      points: tier.points,
      x: cursor,
      y: SHELF_Y - tier.h,
      w: tier.w,
      h: tier.h,
    });
    cursor += tier.w;
  }
  return prizes;
}

/** 奖品中心的横坐标。 */
export function prizeCenterX(prize: Box): number {
  return finite(prize.x) + Math.max(0, finite(prize.w)) / 2;
}

/** 爪子中心到奖品中心的水平距离。 */
export function offsetToPrize(prize: Box, clawX: number): number {
  return Math.abs(finite(clawX) - prizeCenterX(prize));
}

/**
 * 选离爪子最近的奖品（按中心距离）。
 * 距离相同时取更靠左的那个（布局数组本身按 x 升序），空奖池返回 null。
 */
export function pickPrize(prizes: readonly Prize[], clawX: number): Prize | null {
  const x = finite(clawX, (CLAW_MIN + CLAW_MAX) / 2);
  let best: Prize | null = null;
  let bestDistance = Infinity;
  for (const prize of prizes) {
    const distance = offsetToPrize(prize, x);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = prize;
    }
  }
  return best;
}

/* ---------------- 爪子移动 ---------------- */

/** 把爪子中心夹进可移动范围。 */
export function clampClaw(x: number): number {
  return clampNumber(finite(x, CLAW_MIN), CLAW_MIN, CLAW_MAX);
}

/**
 * 横向速度（px/s）：松手 0，按住 90。
 * hold 可以传布尔（键盘 / 手柄按住），也可以传毫秒数（>0 视为按住），
 * 两种写法都返回同一个规格值，避免「按多久速度不一样」的手感差异。
 */
export function clawSpeed(hold: boolean | number): number {
  if (typeof hold === "number") return Math.max(0, finite(hold)) > 0 ? CLAW_SPEED : 0;
  return hold ? CLAW_SPEED : 0;
}

/**
 * 走一帧：dir 取符号（-1 左 / 0 停 / 1 右），heldMs 是这次按住的时长。
 * 返回值已经夹进 [CLAW_MIN, CLAW_MAX]。
 */
export function stepClaw(clawX: number, dir: number, heldMs: number, dtMs: number): number {
  const start = clampClaw(clawX);
  const direction = Math.sign(finite(dir));
  if (direction === 0) return start;
  const distance = (clawSpeed(Math.max(0, finite(heldMs))) * Math.max(0, finite(dtMs))) / 1000;
  return clampClaw(start + direction * distance);
}

/* ---------------- 计分 ---------------- */

/** 一次成功抓取的分：档位底分 + 之前连抓数 × 5。 */
export function scoreForPrize(tier: TierKey | PrizeTier, streak = 0): number {
  const key = typeof tier === "string" ? tier : tier.key;
  const base = tierOf(key).points;
  const chain = Math.max(0, Math.floor(finite(streak)));
  return base + chain * STREAK_POINTS;
}
