/**
 * 像素投篮纯规则层：力度条、初速映射、抛体积分、筐口判定、计分与连击。
 *
 * 不碰 DOM / Canvas / 随机数：所有输入都是普通数字和对象，所以
 * 「力度周期回归」「初速两端」「定步长抛体稳定」「筐口边界」「空心 vs 擦筐」
 * 都能直接单测。
 *
 * ── 关于重力的说明（对规格的一处必要修正） ───────────────────────────
 * docs/game-specs-vol02.md 第 16 节给的常量彼此矛盾：出手点 (30,170)、
 * 筐口 y=96、抛射角 62°、初速 250..430，若同时取重力 900px/s²，
 * 则只有 power >= 0.970 的球才够得着筐口（v=430 时落点 x≈138.6，
 * 而 v=424 以下整条抛物线都在筐口平面之下）。那样力度条 97% 的行程
 * 都是必不进的空球，游戏不可玩。
 *
 * 因此这里保留全部被规格点名的常量（62°、1100ms 周期、250..430、
 * 筐口 x=132 y=96 宽 26、10 球、60 秒），只把 GRAVITY 调到 640，
 * 使命中窗口落在力度 0.600..0.710（约 60ms 松手窗口），
 * 力度条的下半段「太短」、上半段「太长」，读条才有意义。
 */

/* ---------------- 场地与物理 ---------------- */

/** 抛射角固定 62°。 */
export const ANGLE_DEG = 62;
const ANGLE_RAD = (ANGLE_DEG * Math.PI) / 180;

/** 重力 px/s²（见文件头说明：规格的 900 在几何上不可玩）。 */
export const GRAVITY = 640;

/** 初速下限 / 上限 px/s，由 power 线性映射。 */
export const SPEED_MIN = 250;
export const SPEED_MAX = 430;

/** 力度条一个完整来回的周期：0→1→0 共 1100ms。 */
export const POWER_PERIOD_MS = 1100;
/** 半周期：0→1 或 1→0 各占 550ms。 */
export const POWER_LEG_MS = POWER_PERIOD_MS / 2;

/** 每轮 10 球，60 秒到或球用完即结算。 */
export const BALLS_PER_ROUND = 10;
export const ROUND_MS = 60_000;

/** 球半径：画出来是 7×7 的像素圆。 */
export const BALL_R = 3;

export interface Point {
  x: number;
  y: number;
}

/** 出手点：左下角。 */
export const ORIGIN: Point = { x: 30, y: 170 };

/** 篮筐：x 是筐口左沿，y 是筐口平面，w 是筐宽。 */
export interface Rim {
  x: number;
  y: number;
  w: number;
}

export const RIM: Rim = { x: 132, y: 96, w: 26 };

/** 地板高度：球落到这里就算没进。 */
export const FLOOR_Y = 196;

/* ---------------- 计分 ---------------- */

/** 空心（没碰筐沿）+15；擦筐进 +10；不进 0。 */
export const SWISH_POINTS = 15;
export const RIM_POINTS = 10;

/** 筐口两侧各让出 4px：球心落在这里算擦筐，不算空心。 */
export const RIM_MARGIN = 4;

/** 连中达到 3 球，球变金色、combo 栏变金。 */
export const COMBO_HOT = 3;

/**
 * 一次出手的三种结果。
 * 布尔无法表达「空心 / 擦筐进 / 不进」三种不同的计分与连击行为，
 * 所以 make 用三值字符串。
 */
export type MakeKind = "swish" | "rim" | "miss";

/* ---------------- 小球 ---------------- */

export interface Ball {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** 上一帧的位置：筐口判定要用它做「本帧是否穿过筐口平面」的插值。 */
  prevX: number;
  prevY: number;
}

/* ---------------- 力度条 ---------------- */

const clamp01 = (n: number): number => (n < 0 ? 0 : n > 1 ? 1 : n);

/**
 * 按住时长 → 力度 0..1，三角波来回摆动，周期 1100ms。
 *
 * 任意长的按住时间都会被折进一个周期里：550ms 时到顶 1，1100ms 回到 0，
 * 一直按着就会 0→1→0→1 地来回走，永远不会越界。
 */
export function powerFromHold(holdMs: number): number {
  if (!Number.isFinite(holdMs) || holdMs <= 0) return 0;
  const wrapped = holdMs % POWER_PERIOD_MS;
  const phase = wrapped / POWER_PERIOD_MS; // 0..1
  // 前半程上升、后半程下降。
  const power = phase < 0.5 ? phase * 2 : 2 - phase * 2;
  return clamp01(power);
}

/** 力度 → 初速：250..430 px/s 线性映射，越界夹住。 */
export function speedFromPower(power: number): number {
  if (!Number.isFinite(power)) return SPEED_MIN;
  return SPEED_MIN + clamp01(power) * (SPEED_MAX - SPEED_MIN);
}

/* ---------------- 抛体 ---------------- */

/** 从 origin 按 power 出手：角度固定 62°，速度由力度决定。 */
export function shoot(origin: Point, power: number): Ball {
  const speed = speedFromPower(power);
  return {
    x: origin.x,
    y: origin.y,
    vx: Math.cos(ANGLE_RAD) * speed,
    vy: -Math.sin(ANGLE_RAD) * speed,
    prevX: origin.x,
    prevY: origin.y,
  };
}

/** 单个子步最多 4ms：50ms 的大帧会被拆成 13 步，抛物线不会散架。 */
export const MAX_SUBSTEP_MS = 4;

/**
 * 推进一帧抛物线（半隐式欧拉 + 子步）。
 *
 * 引擎的 dt 上限是 50ms，一步走完 430px/s 会跨 21px，过筐口时判定会跳帧，
 * 所以按 4ms 切子步；位置误差与步长平方成正比，50ms 帧和 1ms 帧的落点
 * 差不到 1px（单测里验证）。
 *
 * 原地修改并返回同一个球对象；prevX/prevY 记录本帧起点，
 * 供 inRim 判断「这一帧有没有穿过筐口平面」。
 */
export function stepBall(ball: Ball, dtMs: number): Ball {
  const dt = Number.isFinite(dtMs) && dtMs > 0 ? dtMs : 0;
  ball.prevX = ball.x;
  ball.prevY = ball.y;
  if (dt === 0) return ball;

  const steps = Math.max(1, Math.ceil(dt / MAX_SUBSTEP_MS));
  const h = dt / steps / 1000;
  for (let i = 0; i < steps; i += 1) {
    ball.vy += GRAVITY * h;
    ball.x += ball.vx * h;
    ball.y += ball.vy * h;
  }
  return ball;
}

/**
 * 抛物线够到某个平面的最低初速：要抬升 (origin.y - planeY) 的高度，
 * 竖直分量至少得是 sqrt(2gh)。
 */
export function minSpeedToReach(planeY: number = RIM.y): number {
  const rise = ORIGIN.y - planeY;
  if (rise <= 0) return 0;
  return Math.sqrt(2 * GRAVITY * rise) / Math.sin(ANGLE_RAD);
}

/**
 * 从 origin 以 power 出手，球心下降段穿过 y=planeY 时的横坐标。
 *
 * 解 y(t) = origin.y + vy*t + g*t²/2 = planeY，取较大的根（下降段）。
 * 抛物线顶点低于该平面时（disc < 0）永远够不到，返回 NaN。
 */
export function crossingX(power: number, planeY: number = RIM.y): number {
  const speed = speedFromPower(power);
  const vx = Math.cos(ANGLE_RAD) * speed;
  const vy = -Math.sin(ANGLE_RAD) * speed;
  const drop = ORIGIN.y - planeY;
  const disc = vy * vy - 2 * GRAVITY * drop;
  if (disc < 0) return Number.NaN;
  const t = (-vy + Math.sqrt(disc)) / GRAVITY; // 取下降段的那个根
  return ORIGIN.x + vx * t;
}

/* ---------------- 筐口判定 ---------------- */

/** 本帧球心穿过筐口平面时的横坐标；没穿过返回 NaN。 */
export function rimCrossX(ball: Ball, rim: Rim = RIM): number {
  const dy = ball.y - ball.prevY;
  if (dy <= 0) return Number.NaN; // 这一帧没有向下穿过任何平面
  if (ball.prevY > rim.y || ball.y < rim.y) return Number.NaN; // 平面不在本帧区间内
  const t = (rim.y - ball.prevY) / dy;
  return ball.prevX + (ball.x - ball.prevX) * t;
}

/** 球心穿过筐口 y 区间、且落点在筐宽内 → 进球。 */
export function inRim(ball: Ball, rim: Rim = RIM): boolean {
  const x = rimCrossX(ball, rim);
  if (Number.isNaN(x)) return false;
  return x >= rim.x && x <= rim.x + rim.w;
}

/** 空心：进了，且落点离两侧筐沿都还有 RIM_MARGIN 的余量。 */
export function isSwish(ball: Ball, rim: Rim = RIM): boolean {
  const x = rimCrossX(ball, rim);
  if (Number.isNaN(x)) return false;
  if (x < rim.x || x > rim.x + rim.w) return false;
  return x >= rim.x + RIM_MARGIN && x <= rim.x + rim.w - RIM_MARGIN;
}

/** 一次出手的最终结果，给计分和连击用。 */
export function makeKind(ball: Ball, rim: Rim = RIM): MakeKind {
  if (isSwish(ball, rim)) return "swish";
  if (inRim(ball, rim)) return "rim";
  return "miss";
}

/* ---------------- 计分与连击 ---------------- */

/**
 * 单球得分：空心 +15，擦筐进 +10，不进 0。
 *
 * 连中不放大单球得分（否则 tag「空心 +15」就不成立了）；
 * combo 只负责球变金和 HUD 的 ×N 显示，这里保留参数是为了让调用点对称。
 */
export function scoreFor(make: MakeKind, combo = 0): number {
  void combo;
  if (make === "swish") return SWISH_POINTS;
  if (make === "rim") return RIM_POINTS;
  return 0;
}

/**
 * 连击变化：空心 +1；擦筐进算命中但不涨连中；不进清零。
 */
export function comboAfter(make: MakeKind, combo: number): number {
  const current = Number.isFinite(combo) ? Math.max(0, Math.floor(combo)) : 0;
  if (make === "swish") return current + 1;
  if (make === "rim") return current; // 擦筐进：不连击
  return 0;
}

/* ---------------- 命中窗口（给力度条画出甜区） ---------------- */

export interface PowerWindow {
  low: number;
  high: number;
}

/** 二分反解：落点正好在 targetX 时需要的力度（够不到就夹到端点）。 */
function powerForCrossX(targetX: number): number {
  const atMax = crossingX(1);
  if (Number.isNaN(atMax)) return Number.NaN;
  // 抛物线顶点刚好够到筐口平面的那个力度：低于它的一律是空球。
  const reachPower = (minSpeedToReach() - SPEED_MIN) / (SPEED_MAX - SPEED_MIN);
  const lo0 = Math.min(1, Math.max(0, reachPower));
  if (targetX <= crossingX(lo0)) return lo0;
  if (targetX >= atMax) return 1;

  let lo = lo0;
  let hi = 1;
  for (let i = 0; i < 60; i += 1) {
    const mid = (lo + hi) / 2;
    const cross = crossingX(mid);
    if (Number.isNaN(cross)) lo = mid;
    else if (cross < targetX) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/** 能进球的力度区间：画在力度条上的「甜区」。 */
export function makePowerWindow(rim: Rim = RIM): PowerWindow {
  const a = powerForCrossX(rim.x);
  const b = powerForCrossX(rim.x + rim.w);
  return { low: Math.min(a, b), high: Math.max(a, b) };
}

/** 能空心的力度区间：甜区里更窄的一段。 */
export function swishPowerWindow(rim: Rim = RIM): PowerWindow {
  const a = powerForCrossX(rim.x + RIM_MARGIN);
  const b = powerForCrossX(rim.x + rim.w - RIM_MARGIN);
  return { low: Math.min(a, b), high: Math.max(a, b) };
}
