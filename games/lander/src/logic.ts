/**
 * 月面着陆的纯规则层：物理常量、着陆判定、计分、燃料消耗、地形生成。
 *
 * 不碰 DOM / Canvas；随机源（rand）由调用方注入，
 * 所以「四档着陆判定」「燃料加成单调」「同种子同地形」「着陆带宽度」都能直接单测。
 *
 * 单位约定：位置 px、时间 ms（dt 是毫秒）、角度 rad。
 * 所有「每秒」常量在使用处都乘 dt / 1000。
 */

/* ---------------- 物理常量（规格值，px 每秒） ---------------- */

/** 月面重力：90 px/s²（比地球小，落得慢）。 */
export const GRAVITY = 90;
/** 喷嘴推力：沿飞船正上方 170 px/s²（按住 A）。 */
export const THRUST = 170;
/** 左右旋转角速度：1.8 rad/s。 */
export const TURN_RATE = 1.8;
/** 燃料满载 100 单位。 */
export const FUEL_MAX = 100;
/** 推进时每 80ms 烧 1 单位燃料。 */
export const FUEL_BURN_MS = 80;
/** 地面 y（飞船「着陆架」贴到这条线就算落地）。 */
export const GROUND_Y = 190;
/** 起始高度 y = 30。 */
export const START_Y = 30;
/** 初速：向下 20 px/s。 */
export const START_VY = 20;
/** 初速：水平随机上限 ±14 px/s。 */
export const START_VX_MAX = 14;

/* ---------------- 场景常量 ---------------- */

/** 逻辑分辨率宽（与 meta.size.w 一致）。 */
export const LANDER_W = 168;
/** 飞船像素素材的宽 / 高，绘制时用中心点定位。 */
export const SHIP_W = 11;
export const SHIP_H = 13;
/** 飞船横向可以贴到的边界（留一点边，机身不会画到画面外）。 */
export const SHIP_MARGIN = SHIP_W / 2;
/** 飞船最高不能飞出画面顶部。 */
export const SHIP_CEIL = 8;
/** 高度换算：2 逻辑像素 = 1 米（起点 160px = 80 米）。 */
export const PX_PER_M = 2;
/** 有效着陆带的最小宽度（规格硬性要求 >= 34px）。 */
export const MIN_PAD_W = 34;
/** 单条着陆带的最大宽度：太宽就不用调整姿态了，留一点操作压力。 */
export const PAD_MAX_W = 52;
/** 两条着陆带之间岩石缝的宽度范围。 */
export const ROCK_MIN_W = 12;
export const ROCK_MAX_W = 24;

/* ---------------- 着陆判定的四档阈值 ---------------- */

export const PERFECT_VY = 32;
export const PERFECT_ANGLE = 0.1;
export const GOOD_VY = 58;
export const GOOD_ANGLE = 0.22;
export const ROUGH_VY = 92;
export const ROUGH_ANGLE = 0.42;

export type Verdict = "perfect" | "good" | "rough" | "crash";

/** 各档基础分：perfect 300 / good 200 / rough 100 / crash 0。 */
const BASE_SCORE: Record<Verdict, number> = {
  perfect: 300,
  good: 200,
  rough: 100,
  crash: 0,
};

/* ---------------- 小工具（不依赖 @arcade/core，保持纯函数） ---------------- */

const clamp = (n: number, min: number, max: number): number => (n < min ? min : n > max ? max : n);

const finite = (n: number, fallback: number): number => (Number.isFinite(n) ? n : fallback);

/** 随机源归一化：NaN / 越界一律夹进 [0, 1)。 */
function roll(rand: () => number): number {
  const raw = rand();
  if (!Number.isFinite(raw)) return 0;
  return clamp(raw, 0, 0.999999);
}

/** 把角度收进 (-PI, PI]，整圈旋转等价于没转（物理上真的会转回来）。 */
export function wrapAngle(angle: number): number {
  const a = finite(angle, 0);
  const full = Math.PI * 2;
  let out = a % full;
  if (out <= -Math.PI) out += full;
  else if (out > Math.PI) out -= full;
  return out;
}

/* ---------------- 着陆判定 ---------------- */

/**
 * 四档着陆判定。
 *
 * |vy| 与 |angle| 必须**同时**落在同一档的阈值内才降档；
 * 任意一项越界就继续往下掉一档，全越界（或撞到岩石）就是 crash。
 */
export function landingResult(vy: number, angle: number, onRock = false): Verdict {
  if (onRock) return "crash";
  const speed = Math.abs(finite(vy, ROUGH_VY + 1));
  const tilt = Math.abs(wrapAngle(angle));
  if (speed <= PERFECT_VY && tilt <= PERFECT_ANGLE) return "perfect";
  if (speed <= GOOD_VY && tilt <= GOOD_ANGLE) return "good";
  if (speed <= ROUGH_VY && tilt <= ROUGH_ANGLE) return "rough";
  return "crash";
}

/**
 * 单次着陆得分 = 基础分 + 剩余燃料 * 4 + max(0, 200 - 水平漂移 * 2)。
 *
 * crash 不给分（连基础分都没有）；rough 给 100 —— 船报废了，
 * 但这一次硬着陆本身仍有价值，所以结算分照算。
 */
export function landingScore(verdict: Verdict, fuel: number, driftX: number): number {
  const base = BASE_SCORE[verdict] ?? 0;
  if (base === 0) return 0;
  const fuelBonus = Math.round(clamp(finite(fuel, 0), 0, FUEL_MAX) * 4);
  const drift = Math.abs(finite(driftX, 0));
  const driftBonus = Math.max(0, 200 - Math.round(drift * 2));
  return base + fuelBonus + driftBonus;
}

/* ---------------- 燃料 ---------------- */

/**
 * 消耗燃料：推进时 dt / 80 单位，不推进原样返回。
 * 结果始终夹在 [0, FUEL_MAX]（不会出现负油）。
 */
export function burnFuel(fuel: number, thrusting: boolean, dtMs: number): number {
  const current = clamp(finite(fuel, 0), 0, FUEL_MAX);
  if (!thrusting) return current;
  const dt = Math.max(0, finite(dtMs, 0));
  return clamp(current - dt / FUEL_BURN_MS, 0, FUEL_MAX);
}

/** 高度（米），HUD 的 alt 用；贴地或钻到地下都算 0。 */
export function altitudeMeters(y: number): number {
  const bottom = finite(y, GROUND_Y);
  return Math.max(0, Math.round((GROUND_Y - bottom) / PX_PER_M));
}

/* ---------------- 地形 ---------------- */

export interface TerrainPad {
  x: number;
  w: number;
}

export interface Terrain {
  /** 平坦着陆带，每条宽度都 >= MIN_PAD_W。 */
  pads: TerrainPad[];
  /** 两侧岩石，落上去即 crash。 */
  rocks: TerrainPad[];
}

export function padCenter(pad: TerrainPad): number {
  return pad.x + pad.w / 2;
}

/** 离给定 x 最近的着陆带；没有着陆带时返回 null。 */
export function nearestPad(x: number, pads: readonly TerrainPad[]): TerrainPad | null {
  const at = finite(x, 0);
  let best: TerrainPad | null = null;
  let bestDist = Infinity;
  for (const pad of pads) {
    const dist = Math.abs(at - padCenter(pad));
    if (dist < bestDist) {
      bestDist = dist;
      best = pad;
    }
  }
  return best;
}

/**
 * 程序生成一条着陆带：着陆带与岩石交替，左右各留一段岩石边
 * （着陆点永远在画面中间，不会被逼到边角），整条带刚好铺满 [0, width]。
 *
 * 同种子必须同地形 —— 只吃注入的 rand，不碰 Math.random。
 */
export function terrainFor(rand: () => number, width: number = LANDER_W): Terrain {
  const span = Number.isFinite(width) && width >= MIN_PAD_W + 40 ? width : LANDER_W;
  const pads: TerrainPad[] = [];
  const rocks: TerrainPad[] = [];

  const edge = 8 + Math.round(roll(rand) * 8); // 8–16
  rocks.push({ x: 0, w: edge });
  let x = edge;

  while (x < span) {
    const remaining = span - x;

    // 收尾：剩下不够「一条着陆带 + 一条岩石缝」时，整段并进上一块岩石。
    // 绝不能让步进出一条 < MIN_PAD_W 的窄着陆带 —— 规格要求有效着陆点 >= 34px。
    const tail = rocks[rocks.length - 1];
    if (remaining < MIN_PAD_W + ROCK_MIN_W) {
      if (tail) tail.w += remaining;
      break;
    }

    const maxPad = Math.min(PAD_MAX_W, remaining - ROCK_MIN_W);
    const padW = MIN_PAD_W + Math.round(roll(rand) * (maxPad - MIN_PAD_W));
    pads.push({ x, w: padW });
    x += padW;

    const rest = span - x;
    if (rest <= 0) break;

    // 尾巴只剩一条岩石缝以内的宽度时全部并进去，避免出现 0 宽碎片。
    const rockW = Math.min(rest, ROCK_MIN_W + Math.round(roll(rand) * (ROCK_MAX_W - ROCK_MIN_W)));
    rocks.push({ x, w: rockW });
    x += rockW;
  }

  return { pads, rocks };
}

/** 落点是否在着陆带上（边缘算作着陆带，对玩家更宽容）。 */
export function isOnPad(x: number, pads: readonly TerrainPad[]): boolean {
  const at = finite(x, Number.NaN);
  if (Number.isNaN(at)) return false;
  for (const pad of pads) {
    if (at >= pad.x && at <= pad.x + pad.w) return true;
  }
  return false;
}

/** 撞没撞到岩石（与 isOnPad 互补：既不在任何着陆带上的地面就是岩石）。 */
export function isOnRock(x: number, terrain: Terrain): boolean {
  const at = finite(x, Number.NaN);
  if (Number.isNaN(at)) return true;
  for (const rock of terrain.rocks) {
    if (at >= rock.x && at <= rock.x + rock.w) return true;
  }
  return false;
}

/* ---------------- 画布内触屏按钮 ---------------- */

export type TouchAction = "left" | "right" | "thrust";

export interface TouchButton {
  action: TouchAction;
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * 画布内触屏按钮的布局：地面以下那条 20px 高的控制带，
 * 左 / 推 / 右 三个宽按钮并排，不遮住飞船、着陆带和停机坪指示灯。
 *
 * 虚拟手柄显示时这些按钮不画也不响应，避免和 DOM 手柄抢操作。
 */
export const TOUCH_Y = GROUND_Y + 2;
export const TOUCH_H = 16;
export const TOUCH_W = 52;
export const TOUCH_LAYOUT: readonly TouchButton[] = [
  { action: "left", x: 2, y: TOUCH_Y, w: TOUCH_W, h: TOUCH_H },
  { action: "thrust", x: 58, y: TOUCH_Y, w: TOUCH_W, h: TOUCH_H },
  { action: "right", x: 114, y: TOUCH_Y, w: TOUCH_W, h: TOUCH_H },
];

/** 命中哪个触屏按钮；没命中返回 null。 */
export function touchActionAt(x: number, y: number): TouchAction | null {
  const px = finite(x, Number.NaN);
  const py = finite(y, Number.NaN);
  if (Number.isNaN(px) || Number.isNaN(py)) return null;
  for (const button of TOUCH_LAYOUT) {
    if (px >= button.x && px <= button.x + button.w && py >= button.y && py <= button.y + button.h) {
      return button.action;
    }
  }
  return null;
}

/* ---------------- 飞船状态与积分 ---------------- */

export interface ShipState {
  /** 机身中心的 x（像素）。 */
  x: number;
  /** 着陆架底部的 y（像素），贴地时等于 GROUND_Y。 */
  y: number;
  vx: number;
  vy: number;
  /** 朝向弧度，0 = 机头朝上，正数向右倾。 */
  angle: number;
}

/** 初速：vy 固定 20，vx 由注入的随机源决定 [-14, 14]。 */
export function startVelocity(rand: () => number): { vx: number; vy: number } {
  const r = roll(rand);
  return { vx: (r * 2 - 1) * START_VX_MAX, vy: START_VY };
}

/** 一整局游戏里的第一次下落。 */
export function createShip(x: number, rand: () => number): ShipState {
  const { vx, vy } = startVelocity(rand);
  return { x: finite(x, LANDER_W / 2), y: START_Y, vx, vy, angle: 0 };
}

/**
 * 推进一帧（dt 毫秒）：
 * - angle 先按左右输入转 TURN_RATE * dt/1000；
 * - 推力沿飞船正上方 = (sin a, -cos a)，竖直分量与重力（+y 向下）相加；
 * - 位置夹在画面内：撞到左右边界时清零横向速度，顶到画面顶部时清零上升速度。
 */
export function stepShip(
  ship: ShipState,
  dtMs: number,
  thrusting: boolean,
  turn: number,
): ShipState {
  const dt = Math.max(0, finite(dtMs, 0));
  const seconds = dt / 1000;
  const dir = Math.sign(finite(turn, 0));

  ship.angle = wrapAngle(ship.angle + dir * TURN_RATE * seconds);

  const ax = thrusting ? Math.sin(ship.angle) * THRUST : 0;
  const ay = thrusting ? -Math.cos(ship.angle) * THRUST : 0;

  ship.vx += ax * seconds;
  ship.vy += (GRAVITY + ay) * seconds;

  const nx = ship.x + ship.vx * seconds;
  if (nx < SHIP_MARGIN) {
    ship.x = SHIP_MARGIN;
    ship.vx = 0;
  } else if (nx > LANDER_W - SHIP_MARGIN) {
    ship.x = LANDER_W - SHIP_MARGIN;
    ship.vx = 0;
  } else {
    ship.x = nx;
  }

  ship.y += ship.vy * seconds;
  if (ship.y < SHIP_CEIL) {
    ship.y = SHIP_CEIL;
    if (ship.vy < 0) ship.vy = 0;
  }

  return ship;
}
