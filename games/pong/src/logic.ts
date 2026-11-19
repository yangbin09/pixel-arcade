/**
 * 像素乒乓纯规则层。
 *
 * 竖屏适配（docs/game-specs-vol02.md 第 20 节）：球场从横屏整体旋转 90°，
 * 变成 168×168 的竖场——上下各一块横放的挡板，球沿竖直方向来回，
 * 得分方向也是上下；玩家守下方挡板，AI 守上方挡板。
 *
 * 因此规格里「左右挡板 4×28」的长边常量仍叫 `PADDLE_H`（28），旋转后它沿 x 轴
 * 展开；`clampPaddle` 的参数名沿用规格里的 `y`，含义是「挡板中心沿轨道的位置」，
 * 在这套竖屏坐标里就是横坐标 x。
 *
 * 不碰 DOM / Canvas，随机源由调用方注入，所以反弹角、球速、AI 限速、
 * 挡板夹紧、发球角度、计分都能直接单测。
 */

/* ---------------- 场地 ---------------- */

/** 画布与球场都是正方形 168×168。 */
export const FIELD = 168;
/** 四边留白 6px：侧墙在 x=6/162，球门线在 y=6/162。 */
export const EDGE = 6;

/* ---------------- 球 ---------------- */

/** 球半径 2：画出来是 4×4 方块。 */
export const BALL_R = 2;
/** 初速 110px/s，上限 260px/s。 */
export const BASE_SPEED = 110;
export const MAX_SPEED = 260;
/** 每接住一次球速度 ×1.06。 */
export const SPEED_STEP = 1.06;
/** 挡板边缘对应 ±60°（相对挡板法线）。 */
export const MAX_BOUNCE = Math.PI / 3;
/** 发球方向在竖直方向 ±30° 内随机偏转。 */
export const SERVE_SPREAD = Math.PI / 6;
/** 单个子步最多走 2.5px，避免高速穿板。 */
export const MAX_STEP = 2.5;

/* ---------------- 墙 / 球门 ---------------- */

/** 左右侧墙内沿：球在这两面上竖直反弹。 */
export const WALL_L = EDGE;
export const WALL_R = FIELD - EDGE;
export const BALL_MIN_X = WALL_L + BALL_R;
export const BALL_MAX_X = WALL_R - BALL_R;

/** 上下球门线：球完全越过就丢一分。 */
export const TOP_LINE = EDGE;
export const BOTTOM_LINE = FIELD - EDGE;

/* ---------------- 挡板 ---------------- */

/** 挡板长边 28（规格值，旋转后沿 x 轴），厚度 4。 */
export const PADDLE_H = 28;
/** 挡板半径（半个长边），命中偏移与接球判定都用它。 */
export const PADDLE_HALF = PADDLE_H / 2;
export const PADDLE_T = 4;

/** 顶挡板的下沿、底挡板的上沿：球心在这两个平面上反弹。 */
export const TOP_PLANE = TOP_LINE + PADDLE_T;
export const BOTTOM_PLANE = BOTTOM_LINE - PADDLE_T;

/** 挡板中心的可用轨道：两侧各留半个挡板长度。 */
export const PADDLE_MIN = WALL_L + PADDLE_HALF;
export const PADDLE_MAX = WALL_R - PADDLE_HALF;

/** 玩家挡板速度（px/s）：比 AI 上限快，保证跟手。 */
export const PADDLE_SPEED = 240;

/* ---------------- 一局 ---------------- */

/** 七分制。 */
export const WIN_POINTS = 7;
/** 每拍到球 +1 分，赢下一分再 +50。 */
export const RALLY_POINT = 1;
export const WIN_BONUS = 50;

/* ---------------- AI ---------------- */

export const AI_MAX_LEVEL = 5;
export const AI_DEFAULT_LEVEL = 3;
/**
 * AI 挡板速度上限（px/s）：明显低于玩家挡板（240）和球速上限（260）。
 * 这是「AI 追不上斜线球」的主要来源。任何等级都不会超过它。
 */
export const AI_MAX_SPEED = 170;
/** 等级 1 的 AI 速度，之后线性升到 AI_MAX_SPEED。 */
export const AI_MIN_SPEED = 110;
/**
 * 等级 1 的 AI 只看 0.06s 之后，等级 5 看 0.18s。
 * 外推永远按直线算，不预判侧墙反弹——这就是它会被折射球骗到的原因。
 */
export const AI_MIN_LEAD = 0.06;
export const AI_LEAD_STEP = (0.18 - AI_MIN_LEAD) / (AI_MAX_LEVEL - 1);
/** AI 的反应延迟（毫秒）：等级 1 看到 280ms 前的球，等级 5 看到 120ms 前。 */
export const AI_MIN_REACTION = 120;
export const AI_MAX_REACTION = 280;

/* ---------------- 触摸拖动 ---------------- */

/** 触摸相对拖动灵敏度：手指横移 1px，挡板走 1.4px。 */
export const DRAG_SENSITIVITY = 1.4;

/* ---------------- 类型 ---------------- */

export interface Ball {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** 速度大小，反弹只改方向不改大小。 */
  speed: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 一次触摸拖动的锚点：手指起点 + 按下瞬间的挡板中心。 */
export interface DragAnchor {
  startX: number;
  centerX: number;
}

/* ---------------- 小工具 ---------------- */

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return value < min ? min : value > max ? max : value;
}

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.round(value)));
}

/* ---------------- 挡板 ---------------- */

/**
 * 挡板中心夹进轨道。
 *
 * 参数名沿用规格里的 `y`：它表示挡板中心沿轨道的位置（竖屏坐标里是 x），
 * 不是屏幕纵坐标。非有限值兜底回球场中心。
 */
export function clampPaddle(y: number): number {
  if (!Number.isFinite(y)) return FIELD / 2;
  return clampNumber(y, PADDLE_MIN, PADDLE_MAX);
}

/** 挡板覆盖的横向区间 [left, right]。 */
export function paddleSpan(center: number): { left: number; right: number } {
  const c = clampPaddle(center);
  return { left: c - PADDLE_HALF, right: c + PADDLE_HALF };
}

/** 某个球心横坐标是否落在挡板接球范围内（含球半径）。 */
export function catchesPaddle(
  ballX: number,
  paddleCenter: number,
  reach = PADDLE_HALF + BALL_R,
): boolean {
  if (!Number.isFinite(ballX) || !Number.isFinite(paddleCenter)) return false;
  return Math.abs(ballX - clampPaddle(paddleCenter)) <= reach;
}

/** 命中点相对挡板中心的偏移，归一化到 -1..1。 */
export function hitOffset(ballX: number, paddleCenter: number): number {
  if (!Number.isFinite(ballX) || !Number.isFinite(paddleCenter)) return 0;
  return clampNumber((ballX - paddleCenter) / PADDLE_HALF, -1, 1);
}

/* ---------------- 反弹 ---------------- */

/**
 * 命中点偏移 → 反弹角（弧度，相对挡板法线）。
 * -1..1 线性映射到 -60°..+60°，0 表示正中（沿法线直飞）。
 */
export function reflectAngle(offset: number): number {
  return clampNumber(offset, -1, 1) * MAX_BOUNCE;
}

/**
 * 反弹后的速度分量。
 *
 * `dir = -1` 表示球往上飞（顶挡板），`dir = +1` 表示往下飞（底挡板）：
 * 偏移为正时球飞向右侧，为负时飞向左侧。
 */
export function bounceVelocity(
  offset: number,
  speed: number,
  dir: 1 | -1,
): { vx: number; vy: number } {
  const angle = reflectAngle(offset);
  const magnitude = clampNumber(speed, 0, MAX_SPEED);
  return {
    vx: Math.sin(angle) * magnitude,
    vy: dir * Math.cos(angle) * magnitude,
  };
}

/** 发球方向：rng 注入，返回相对竖直方向的 ±30° 偏转。 */
export function serveAngle(rng: () => number = Math.random): number {
  const roll = Number(rng());
  const t = Number.isFinite(roll) ? clampNumber(roll, 0, 1) : 0.5;
  return (t * 2 - 1) * SERVE_SPREAD;
}

/**
 * 每接住一次球 +6%，上限 MAX_SPEED；rally 为本次加速累计的拍数。
 * 速度非法时从初速算起，拍数非法时按 0 算，永远不返回 NaN。
 */
export function speedUp(speed: number, rally = 0): number {
  const base = Number.isFinite(speed) && speed > 0 ? speed : BASE_SPEED;
  const hits = Number.isFinite(rally) ? Math.max(0, Math.floor(rally)) : 0;
  return clampNumber(base * Math.pow(SPEED_STEP, hits), 0, MAX_SPEED);
}

/* ---------------- 子步进 ---------------- */

/** 本帧拆成几个子步：每步位移不超过 maxStep。 */
export function substepsFor(distance: number, maxStep = MAX_STEP): number {
  if (!Number.isFinite(distance) || distance <= 0) return 1;
  const step = Math.max(1, maxStep);
  return Math.max(1, Math.ceil(distance / step));
}

/* ---------------- 得分 ---------------- */

/** 一个回合结束时的得分：每拍 +1，赢下这分再 +50。 */
export function scoreForRally(rally: number, won: boolean): number {
  const hits = Number.isFinite(rally) ? Math.max(0, Math.floor(rally)) : 0;
  return hits * RALLY_POINT + (won ? WIN_BONUS : 0);
}

/** 球是否越过球门线；越顶线是玩家得分，越底线是 AI 得分。 */
export function goalScored(ball: Pick<Ball, "y">): "player" | "ai" | null {
  if (!Number.isFinite(ball.y)) return null;
  if (ball.y + BALL_R <= TOP_LINE) return "player";
  if (ball.y - BALL_R >= BOTTOM_LINE) return "ai";
  return null;
}

/* ---------------- AI ---------------- */

/** AI 等级对应的挡板速度上限：从 AI_MIN_SPEED 线性升到 AI_MAX_SPEED。 */
export function aiSpeed(level: number): number {
  const lv = clampInt(level, 1, AI_MAX_LEVEL);
  return AI_MIN_SPEED + (lv - 1) * ((AI_MAX_SPEED - AI_MIN_SPEED) / (AI_MAX_LEVEL - 1));
}

/** AI 反应延迟（毫秒）：等级越高看得越「新」，但永远有延迟。 */
export function aiReaction(level: number): number {
  const lv = clampInt(level, 1, AI_MAX_LEVEL);
  return AI_MAX_REACTION - (lv - 1) * ((AI_MAX_REACTION - AI_MIN_REACTION) / (AI_MAX_LEVEL - 1));
}

/** 把横坐标按侧墙反射折回球场（可反复折返）。 */
export function foldX(x: number): number {
  if (!Number.isFinite(x)) return FIELD / 2;
  const span = BALL_MAX_X - BALL_MIN_X;
  if (span <= 0) return BALL_MIN_X;
  const period = span * 2;
  let t = (x - BALL_MIN_X) % period;
  if (t < 0) t += period;
  return t <= span ? BALL_MIN_X + t : BALL_MIN_X + (period - t);
}

/**
 * 预测球飞到顶挡板平面时的球心横坐标，会把侧墙反弹折回场内。
 * AI 的弱点不在这里，而在「看到的是反应延迟之前的球」（见 index.ts），
 * 所以斜线球会因为它判断滞后而漏接。
 */
export function predictLandingX(ball: Ball): number {
  if (!Number.isFinite(ball.x) || !Number.isFinite(ball.y) || !Number.isFinite(ball.vx)) {
    return FIELD / 2;
  }
  if (!(ball.vy < 0)) return foldX(ball.x);
  const plane = TOP_PLANE + BALL_R;
  const eta = (ball.y - plane) / -ball.vy;
  if (!Number.isFinite(eta) || eta <= 0) return foldX(ball.x);
  return foldX(ball.x + ball.vx * eta);
}

/**
 * AI 挡板想去的中心位置。
 *
 * 它不是先知：只拿「手里这颗（带反应延迟的）球」做一次短程线性外推，
 * 等级越高看得越远（0.06s 到 0.18s），但永远不计算侧墙反弹。
 * 于是斜线球和折射球会把它带到错误的位置，玩家因此能拿分；
 * 直线球它接得很稳，手感公平。
 */
export function aiTarget(ball: Ball, level: number = AI_DEFAULT_LEVEL): number {
  const lv = clampInt(level, 1, AI_MAX_LEVEL);
  if (!Number.isFinite(ball.x) || !Number.isFinite(ball.y)) return FIELD / 2;
  // 球往玩家半场飞时回中线待命，别贴在顶线上。
  if (!(ball.vy < 0)) return FIELD / 2;

  const lead = AI_MIN_LEAD + (lv - 1) * AI_LEAD_STEP;
  const predictedX = ball.x + (Number.isFinite(ball.vx) ? ball.vx : 0) * lead;
  return clampPaddle(predictedX);
}

/**
 * AI 挡板朝目标移动一步：速度受 maxSpeed 限制，永远不会瞬移过去。
 * dt 为毫秒；dt 很大时也只走 maxSpeed × dt 的距离，并夹在轨道内。
 */
export function aiStep(
  center: number,
  target: number,
  dt: number,
  maxSpeed: number = AI_MAX_SPEED,
): number {
  const from = clampPaddle(center);
  const to = clampPaddle(target);
  const seconds = Number.isFinite(dt) ? Math.max(0, dt) / 1000 : 0;
  const limit = Math.max(0, Number.isFinite(maxSpeed) ? maxSpeed : 0) * seconds;
  const delta = to - from;
  if (Math.abs(delta) <= limit) return to;
  return clampPaddle(from + Math.sign(delta) * limit);
}

/* ---------------- 触摸拖动 ---------------- */

/** 记录触摸拖动锚点，按下时挡板不瞬移。 */
export function dragAnchor(pointerX: number, centerX: number): DragAnchor {
  return {
    startX: Number.isFinite(pointerX) ? pointerX : 0,
    centerX: clampPaddle(centerX),
  };
}

/** 相对拖动目标：锚点 + 手指横移 × 灵敏度，再夹进轨道。 */
export function dragTarget(
  anchor: DragAnchor,
  pointerX: number,
  sensitivity = DRAG_SENSITIVITY,
): number {
  if (!Number.isFinite(pointerX)) return clampPaddle(anchor.centerX);
  return clampPaddle(anchor.centerX + (pointerX - anchor.startX) * sensitivity);
}

/* ---------------- 几何 ---------------- */

/** 挡板矩形（centerX 为挡板中心，planeY 为挡板上/下沿）。 */
export function paddleRect(centerX: number, planeY: number): Rect {
  const span = paddleSpan(centerX);
  return { x: span.left, y: planeY, w: PADDLE_H, h: PADDLE_T };
}

/** 球的 AABB：半径 2 的圆按 4×4 方块处理。 */
export function ballBox(cx: number, cy: number, r = BALL_R): Rect {
  return { x: cx - r, y: cy - r, w: r * 2, h: r * 2 };
}

export function overlap(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}
