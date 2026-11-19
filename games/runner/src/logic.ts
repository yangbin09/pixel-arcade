/**
 * 像素跑酷的纯规则层：速度曲线、蓄力跳跃、障碍 / 金币几何、碰撞与计分。
 *
 * 不碰 DOM / Canvas；随机源（rng）由调用方注入，
 * 所以「速度上限」「蓄力两端」「滑行变矮」「金币落在跳跃弧线上」都能直接单测。
 */
import { clamp } from "@arcade/core";

/* ---------------- 场景常量 ---------------- */

export const W = 168;
export const H = 210;

/** 地面 y：脚底贴地的那条线，跑道从 y=170 到画面底部。 */
export const GROUND_Y = 170;
/** 玩家固定横坐标（碰撞盒中心）。 */
export const PLAYER_X = 40;
/** 玩家视觉宽度 16；站立高 30，滑行高 16。 */
export const PLAYER_W = 16;
export const PLAYER_H = 30;
export const SLIDE_H = 16;
/**
 * 碰撞盒只用 10 宽（视觉 16 宽）。
 *
 * 这是跑酷类游戏的常规做法：视觉上人看起来有 16 宽，判定缩到 10，
 * 「擦边过」才不会判定成撞击。实测算下来，120px/s 时木箱的起跳
 * 容错窗口从 96ms 放宽到约 130ms，手感从「苛刻」变成「可练」。
 */
export const PLAYER_HIT_W = 10;

/** 重力 900px/s²；起跳初速 -270，蓄满 -330（向上为负）。 */
export const GRAVITY = 900;
export const JUMP_V = -270;
export const JUMP_V_MAX = -330;
/** 蓄力窗口：按住 180ms 即满。 */
export const HOLD_MS = 180;
/** 滑行持续时间 420ms。 */
export const SLIDE_MS = 420;

/** 速度：120px/s 起，每 200 米 +14px/s，上限 300。 */
export const SPEED_BASE = 120;
export const SPEED_MAX = 300;
export const SPEED_STEP = 14;
export const SPEED_STEP_DIST = 200;

/**
 * 1 米 = 6 逻辑像素。
 *
 * 这个比例同时决定两条曲线，6 是两边的折中：
 * - 提速：200 米 = 1200px，起步速度下约 10 秒一档，约 78 秒到 300 封顶，
 *   正好落在「1–2 分钟」的单局长度上；
 * - 障碍间距：spawnGap 44–72 米 = 264–432px，换算成时间间隔是
 *   起步约 3.6 秒、满速约 0.88 秒 —— 始终大于一次不蓄力跳跃 0.6 秒的滞空。
 */
export const PX_PER_M = 6;

/** 金币 +10 分，半径 4。 */
export const COIN_SCORE = 10;
export const COIN_R = 4;
/** 拾取判定四周额外放宽的像素，让「擦到」也算吃到。 */
export const COIN_PICKUP_PAD = 2;

/**
 * 横梁：可见梁体厚 34px（规格值），下沿离地 18px。
 *
 * 碰撞盒从**画面顶端**一直垂到梁下沿：只留 18px 净空，
 * 这样「必须滑」才是真的 —— 否则满蓄力一跳的脚底能升到 111.5，
 * 反而从 118 的梁顶翻过去，规则就变成「高跳也能过」了。
 * 视觉上梁上方画吊索，和这个碰撞盒一致。
 */
export const BEAM_H = 34;
export const BEAM_CLEARANCE = 18;
/** 梁下沿的 y（碰撞盒底边）。 */
export const BEAM_BOTTOM = GROUND_Y - BEAM_CLEARANCE;
/** 梁碰撞盒的高度：从 y=0 垂到底沿，跳不过去。 */
export const BEAM_SPAN = BEAM_BOTTOM;

/** 飞鸟盒子上沿的浮动范围 110–130。 */
export const BIRD_MIN_Y = 110;
export const BIRD_MAX_Y = 130;
/** 飞鸟在自己基准高度上下的呼吸幅度，结果会钳回 [MIN, MAX]。 */
export const BIRD_BOB = 2.5;

/** 身体中线相对脚底的高度：金币贴着这条线飞，跳起来正好从中间穿过。 */
export const BODY_MID = PLAYER_H / 2;

export type ObstacleKind = "box" | "beam" | "bird";

/**
 * 三种障碍的尺寸（宽 × 高），与 obstacleBox 的定位一一对应：
 *
 * - box 28×18，贴地（盒子 152–170）：站立和滑行都撞，必须跳。
 * - beam 20×152，从画面顶端垂到离地 18px 处：
 *   站立（140–170）撞、滑行（154–170）能钻；跳到顶点（脚底 129.5 或 111.5）
 *   身体仍然整个卡在梁里，所以**必须滑**，跳是过不去的。
 * - bird 16×10，上沿在 110–130 浮动（盒子底边最多 140，贴着站立玩家的头顶）：
 *   严格 AABB 下跑着和滑着都安全，只有跳起来撞进它怀里才会死 —— 可跳可滑。
 */
export const OBSTACLE_SIZE: Record<ObstacleKind, { w: number; h: number }> = {
  box: { w: 28, h: 18 },
  beam: { w: 20, h: BEAM_SPAN },
  bird: { w: 16, h: 10 },
};

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Obstacle {
  id: number;
  kind: ObstacleKind;
  /** 左边缘（逻辑像素，随世界滚动左移）。 */
  x: number;
  /** 飞鸟的基准上沿（110–130）；box / beam 不使用。 */
  baseY?: number;
}

export interface Coin {
  x: number;
  y: number;
  taken: boolean;
}

/** 跳跃弧线上的一枚金币：dx 相对起跳点，y 是绝对坐标。 */
export interface CoinSpot {
  dx: number;
  y: number;
}

/** 玩家的竖直状态：跑酷里唯一的物理量。 */
export interface PlayerState {
  /** 脚底 y（贴地时等于 GROUND_Y）。 */
  feetY: number;
  airborne: boolean;
  /** 起跳后经过的毫秒。 */
  airMs: number;
  /** 起跳后按住 A 的毫秒（松手就冻结在这个值）。 */
  holdMs: number;
}

/* ---------------- 速度与难度曲线 ---------------- */

/**
 * 世界滚动速度：120px/s 起，每 200 米 +14px/s，封顶 300。
 * NaN / 负数按 0 米处理，+∞ 按最远距离处理（夹到上限）。
 */
export function speedAt(dist: number): number {
  const meters = safeMeters(dist);
  const steps = Math.floor(meters / SPEED_STEP_DIST);
  return Math.min(SPEED_MAX, SPEED_BASE + steps * SPEED_STEP);
}

/** HUD 的「速度档」：1 档起步，每 200 米 +1，夹在两位数字里。 */
export function speedLevel(dist: number): number {
  const meters = safeMeters(dist);
  return clamp(1 + Math.floor(meters / SPEED_STEP_DIST), 1, 99);
}

/** 像素 → 米。 */
export function metersOf(px: number): number {
  return safeMeters(px) / PX_PER_M;
}

/** 距离归一化：NaN / 负 → 0，+∞ → 一个足够大的有限值（后续会被上限夹住）。 */
function safeMeters(value: number): number {
  if (Number.isNaN(value) || value < 0) return 0;
  if (value === Number.POSITIVE_INFINITY) return Number.MAX_SAFE_INTEGER;
  return value;
}

/* ---------------- 跳跃 ---------------- */

/**
 * 蓄力映射：按住 0ms → -270，按住 ≥180ms → -330，中间线性插值。
 * 负数 / NaN 按「没按」处理。
 */
export function jumpVelocity(holdMs: number): number {
  const held = clamp(Number.isFinite(holdMs) ? holdMs : 0, 0, HOLD_MS);
  return JUMP_V + (JUMP_V_MAX - JUMP_V) * (held / HOLD_MS);
}

/**
 * 距起跳点的上升高度（像素，>= 0）。
 *
 * 「按住 A 到顶点持续加高」在这个模型里等价于「按得越久，等效初速越大」：
 * 同一条抛物线用 jumpVelocity(holdMs) 当 v₀，两端正好对得上规格 ——
 * 不蓄力顶点 40.5px（够跨 18px 的木箱），蓄满顶点 60.5px（够钉在横梁上方）。
 */
export function jumpHeight(airMs: number, holdMs = 0): number {
  const t = (Number.isFinite(airMs) ? Math.max(0, airMs) : 0) / 1000;
  const v = -jumpVelocity(holdMs);
  const height = v * t - 0.5 * GRAVITY * t * t;
  return height > 0 ? height : 0;
}

/** 一次跳跃的滞空时间（毫秒）= 2v/g：不蓄 600ms，蓄满约 733ms。 */
export function airTimeMs(holdMs = 0): number {
  return Math.round((2 * -jumpVelocity(holdMs) * 1000) / GRAVITY);
}

/** 一个新的地面玩家。 */
export function createPlayer(): PlayerState {
  return { feetY: GROUND_Y, airborne: false, airMs: 0, holdMs: 0 };
}

/** 起跳：从地面进入腾空状态（按住时长之后由 stepPlayer 累加）。 */
export function takeOff(player: PlayerState): PlayerState {
  player.airborne = true;
  player.airMs = 0;
  player.holdMs = 0;
  player.feetY = GROUND_Y;
  return player;
}

/**
 * 竖直方向推进一帧（毫秒）。
 * 按住 A 时 holdMs 继续累加（等效初速变大 → 顶点更高），落地自动归位。
 */
export function stepPlayer(player: PlayerState, dtMs: number, holdJump: boolean): PlayerState {
  if (!player.airborne) {
    player.feetY = GROUND_Y;
    player.airMs = 0;
    player.holdMs = 0;
    return player;
  }

  const dt = Number.isFinite(dtMs) ? Math.max(0, dtMs) : 0;
  player.airMs += dt;
  if (holdJump && player.holdMs < HOLD_MS) {
    player.holdMs = Math.min(HOLD_MS, player.holdMs + dt);
  }

  const height = jumpHeight(player.airMs, player.holdMs);
  if (height <= 0) {
    player.feetY = GROUND_Y;
    player.airborne = false;
    player.airMs = 0;
    player.holdMs = 0;
    return player;
  }

  player.feetY = GROUND_Y - height;
  return player;
}

/* ---------------- 生成节奏 ---------------- */

/**
 * 障碍生成间隔（米）：clamp(72 - speed * 0.12, 44, 72)。
 * 速度越高间隔越短，44 米是下限，保证不会密到无解。
 */
export function spawnGap(speed: number): number {
  const px = Number.isFinite(speed) ? Math.max(0, speed) : 0;
  return clamp(72 - px * 0.12, 44, 72);
}

/** 间隔（米）→ 世界像素，摆放障碍时用。 */
export function spawnGapPx(speed: number): number {
  return spawnGap(speed) * PX_PER_M;
}

/**
 * 掷一种障碍：0–0.42 箱子、0.42–0.74 横梁、其余飞鸟。
 * 和上一只同款时顺移一档，避免连续两次同款操作。
 */
export function pickObstacleKind(rng: () => number, last?: ObstacleKind): ObstacleKind {
  const raw = rng();
  const roll = clamp(Number.isFinite(raw) ? raw : 0, 0, 0.999999);
  const kind: ObstacleKind = roll < 0.42 ? "box" : roll < 0.74 ? "beam" : "bird";
  if (kind !== last) return kind;
  return kind === "box" ? "beam" : kind === "beam" ? "bird" : "box";
}

/**
 * 造一只障碍：只有左边缘和种类。
 * 飞鸟额外记一个基准上沿（110–130 的整数），由 rng 决定。
 */
export function makeObstacle(
  kind: ObstacleKind,
  x: number,
  id = 0,
  rng: () => number = Math.random,
): Obstacle {
  const obstacle: Obstacle = { id, kind, x };
  if (kind === "bird") {
    const raw = rng();
    const roll = clamp(Number.isFinite(raw) ? raw : 0, 0, 0.999999);
    obstacle.baseY = BIRD_MIN_Y + Math.round(roll * (BIRD_MAX_Y - BIRD_MIN_Y));
  }
  return obstacle;
}

/* ---------------- 几何 ---------------- */

/**
 * 玩家碰撞盒。y 传脚底坐标（贴地时等于 GROUND_Y），盒子向上生长：
 * 站立 30 高（140–170），滑行 16 高（154–170）—— 顶边随滑行下移 14px。
 * 宽度取 PLAYER_HIT_W（比视觉的 16 窄），擦边不算撞。
 */
export function playerBox(y: number, sliding: boolean): Box {
  const height = sliding ? SLIDE_H : PLAYER_H;
  const feet = Number.isFinite(y) ? y : GROUND_Y;
  return { x: PLAYER_X - PLAYER_HIT_W / 2, y: feet - height, w: PLAYER_HIT_W, h: height };
}

/**
 * 飞鸟当前的上沿 y：基准 + 与横坐标绑定的呼吸，钳在 [110, 130]。
 * 用 x 求正弦而不是用时间，同一个 x 永远得到同一个高度，纯函数可测。
 */
export function birdY(obstacle: Obstacle): number {
  const base = clamp(
    Number.isFinite(obstacle.baseY) ? (obstacle.baseY as number) : BIRD_MIN_Y,
    BIRD_MIN_Y,
    BIRD_MAX_Y,
  );
  const bob = Math.sin((Number.isFinite(obstacle.x) ? obstacle.x : 0) / 11) * BIRD_BOB;
  return clamp(base + bob, BIRD_MIN_Y, BIRD_MAX_Y);
}

/** 障碍碰撞盒（与上面的几何说明一一对应）。 */
export function obstacleBox(obstacle: Obstacle): Box {
  const size = OBSTACLE_SIZE[obstacle.kind];
  let y: number;
  if (obstacle.kind === "box") {
    y = GROUND_Y - size.h;
  } else if (obstacle.kind === "beam") {
    // 横梁从画面顶端垂到梁下沿：头顶上方没有可以「翻过去」的空隙
    y = 0;
  } else {
    y = birdY(obstacle);
  }
  return { x: obstacle.x, y, w: size.w, h: size.h };
}

/** 金币的方形碰撞盒。 */
export function coinBox(coin: Coin): Box {
  return { x: coin.x - COIN_R, y: coin.y - COIN_R, w: COIN_R * 2, h: COIN_R * 2 };
}

/** 严格 AABB：边缘正好相接不算碰撞（滑行 16 从 18px 的梁下钻过）。 */
export function overlaps(a: Box, b: Box): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/** 这一帧撞到的障碍；没有就返回 null。 */
export function collisionAt(
  feetY: number,
  sliding: boolean,
  obstacles: readonly Obstacle[],
): Obstacle | null {
  const box = playerBox(feetY, sliding);
  for (const obstacle of obstacles) {
    if (overlaps(box, obstacleBox(obstacle))) return obstacle;
  }
  return null;
}

/** 金币是否被这次身位吃到（判定盒四周放宽 COIN_PICKUP_PAD）。 */
export function coinPicked(feetY: number, sliding: boolean, coin: Coin): boolean {
  if (coin.taken) return false;
  const body = playerBox(feetY, sliding);
  const padded: Box = {
    x: body.x - COIN_PICKUP_PAD,
    y: body.y - COIN_PICKUP_PAD,
    w: body.w + COIN_PICKUP_PAD * 2,
    h: body.h + COIN_PICKUP_PAD * 2,
  };
  return overlaps(padded, coinBox(coin));
}

/* ---------------- 金币 ---------------- */

/**
 * 一条「跳跃可达」的金币弧线（dx 相对起跳点，y 是绝对坐标）。
 *
 * 用不蓄力的弹道采样 0.14 / 0.28 / 0.42 秒：三颗金币分别落在爬升、
 * 顶点、下落三段，任何一次普通起跳都够得着。金币中心贴玩家身体中线，
 * 而身体中线的高度正好等于同一时刻的 jumpHeight，所以腾空时正面穿过。
 */
export const COIN_ARC_TIMES: readonly number[] = [0.14, 0.28, 0.42];

export function coinArc(
  speed: number,
  maxSpan = Infinity,
  times: readonly number[] = COIN_ARC_TIMES,
): CoinSpot[] {
  const vx = Number.isFinite(speed) ? Math.max(0, speed) : 0;
  const span = Number.isFinite(maxSpan) ? maxSpan : Infinity;
  const spots: CoinSpot[] = [];
  for (const t of times) {
    const dx = vx * t;
    if (dx > span) continue;
    spots.push({ dx, y: GROUND_Y - jumpHeight(t * 1000, 0) - BODY_MID });
  }
  return spots;
}

/** 去掉压在障碍上的金币：金币只留在障碍之间的安全区。 */
export function safeCoins(coins: readonly Coin[], obstacles: readonly Obstacle[]): Coin[] {
  const boxes = obstacles.map(obstacleBox);
  const out: Coin[] = [];
  for (const coin of coins) {
    const box = coinBox(coin);
    if (!boxes.some((other) => overlaps(box, other))) out.push(coin);
  }
  return out;
}

/* ---------------- 计分 ---------------- */

/** 金币 +10；第二参数是已有分数，方便链式累加。 */
export function addScore(coin: boolean, score = 0): number {
  const base = Number.isFinite(score) ? Math.max(0, Math.floor(score)) : 0;
  return base + (coin ? COIN_SCORE : 0);
}

/** HUD 固定位数：超出就夹住，避免像素字撑破栏位。 */
export function clampHud(value: number, max: number): number {
  const ceiling = Number.isFinite(max) ? Math.max(0, Math.round(max)) : 0;
  if (Number.isNaN(value) || value === Number.NEGATIVE_INFINITY) return 0;
  return clamp(Math.round(value), 0, ceiling);
}
