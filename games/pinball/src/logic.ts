/**
 * 弹珠台纯规则层。
 *
 * 只处理几何常量、子步积分、墙面 / 缓冲器 / 挡板的碰撞与计分倍率，
 * 不碰 DOM / Canvas、不调用 `Math.random()`，因此可以直接单测。
 *
 * 物理常量全部来自 docs/game-specs-vol03.md「29. pinball」，
 * 已由主 agent 用 60 次 × 20 秒仿真验证过，**不要自行改动**：
 *   GRAVITY = 150 让自由落体末速（251px/s）刚好低于速度上限（260px/s）；
 *   SUB_STEP_MS = 4 让满速下单子步位移 1.04px < 球半径 4px，
 *   而整帧 50ms 不分子步会位移 13px，直接穿过 5px 厚的挡板。
 */

/* ---------------- 台面几何 ---------------- */

export const FIELD_W = 168;
export const FIELD_H = 210;

/** 左 / 右 / 顶三面墙的内壁坐标。球心被夹在墙面内侧一个半径处。 */
export const WALL_L = 4;
export const WALL_R = 164;
export const WALL_TOP = 8;

/** 球心允许的坐标范围（不含掉球）。 */
export const BALL_MIN_X = WALL_L + 4;
export const BALL_MAX_X = WALL_R - 4;
export const BALL_MIN_Y = WALL_TOP + 4;

/** 掉球线：球心越过这里就算掉出底部。 */
export const DRAIN_Y = FIELD_H;

/* ---------------- 物理常量（不要改） ---------------- */

export const GRAVITY = 150;
export const MAX_BALL_SPEED = 260;
export const BALL_R = 4;
export const SUB_STEP_MS = 4;
export const WALL_RESTITUTION = 0.92;
export const BUMPER_RESTITUTION = 1.02;

export interface Bumper {
  x: number;
  y: number;
  r: number;
}

export const BUMPERS: readonly Bumper[] = [
  { x: 40, y: 72, r: 10 },
  { x: 128, y: 72, r: 10 },
  { x: 84, y: 116, r: 10 },
];

/* ---------------- 挡板 ---------------- */

export const FLIP_LEN = 34;
export const FLIP_Y = 186;
export const FLIP_XL = 30;
export const FLIP_XR = 138;
/** 静止角度（向下、朝内收）。 */
export const FLIP_FROM = 28;
/** 抬起角度。 */
export const FLIP_TO = -24;
/** 从 FLIP_FROM 转到 FLIP_TO 的时间（毫秒）。 */
export const FLIP_MS = 90;
/** 挡板线段厚度（碰撞半径 = BALL_R + FLIP_THICK / 2）。 */
export const FLIP_THICK = 5;
/** 命中挡板后的法线反射系数。 */
export const FLIP_RESTITUTION = 0.95;

/** 角速度：52° / 90ms ≈ 0.5778 度每毫秒；尖端 34px 处线速度约 343px/s。 */
export const FLIP_ANGULAR_SPEED = (FLIP_FROM - FLIP_TO) / FLIP_MS;

export type FlipperSide = "left" | "right";

export interface Segment {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface FlipperState {
  side: FlipperSide;
  /** 当前角度（deg），落在 FLIP_TO..FLIP_FROM 之间。 */
  angle: number;
  /** 角速度（deg/ms）：负数表示正在抬起。 */
  omega: number;
}

/* ---------------- 靶标（两侧各 3 个） ---------------- */

export const TARGET_W = 4;
export const TARGET_H = 10;
/** 打满 6 个靶标的奖励分。 */
export const TARGET_POINTS = 1000;

export interface Target {
  side: FlipperSide;
  y: number;
}

/** 每侧 3 个，嵌在墙体内壁上。 */
export const TARGETS: readonly Target[] = [
  { side: "left", y: 58 },
  { side: "left", y: 102 },
  { side: "left", y: 146 },
  { side: "right", y: 58 },
  { side: "right", y: 102 },
  { side: "right", y: 146 },
];

export const TARGET_COUNT = TARGETS.length;

/** 靶标矩形：左侧贴 WALL_L，右侧贴 WALL_R 内壁。 */
export function targetRect(target: Target): { x: number; y: number; w: number; h: number } {
  return {
    x: target.side === "left" ? WALL_L : WALL_R - TARGET_W,
    y: target.y,
    w: TARGET_W,
    h: TARGET_H,
  };
}

/* ---------------- 底部导向轨 ---------------- */

/**
 * 静止的斜面导轨：把沿侧墙下落的球送进挡板根部。
 *
 * 终点必须**收在挡板根部略偏内下方**（FLIP_XL + 1, FLIP_Y + 2）：
 * 若终点落在根部外侧，就会在挡板扫不到的地方形成一个小口袋，
 * 球会卡在那里永远掉不下去、也弹不起来。收进根部后，球的出口
 * 正好在挡板的扫掠范围内，抬板必能踢到。
 */
export const GUIDE_THICK = 3;

export const GUIDES: readonly Segment[] = [
  { x0: WALL_L, y0: FLIP_Y - 18, x1: FLIP_XL + 1, y1: FLIP_Y + 2 },
  { x0: WALL_R, y0: FLIP_Y - 18, x1: FLIP_XR - 1, y1: FLIP_Y + 2 },
];

/* ---------------- 计分 / 一局 ---------------- */

/** 缓冲器基础分，实际得分 = 基础分 × 倍率。 */
export const BUMPER_BASE = 100;
/** 连击窗口：两次缓冲器命中间隔小于这个值就加倍率。 */
export const COMBO_WINDOW_MS = 900;
/** 倍率上限。 */
export const MAX_MULT = 8;
/** 一局几颗球。 */
export const START_BALLS = 3;

export interface Ball {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

/** 子步里发生的事件，交给玩法层播声音 / 加分。 */
export type BallEvent =
  | { kind: "wall"; side: "left" | "right" | "top" }
  | { kind: "bumper"; index: number }
  | { kind: "target"; index: number }
  | { kind: "flipper"; side: FlipperSide }
  | { kind: "drain" };

/* ---------------- 纯函数 ---------------- */

const min = (a: number, b: number): number => (a < b ? a : b);
const max = (a: number, b: number): number => (a > b ? a : b);
const clamp = (n: number, lo: number, hi: number): number => (n < lo ? lo : n > hi ? hi : n);

/** 满速夹取：方向不变，模长不超过 MAX_BALL_SPEED。 */
export function clampSpeed(vx: number, vy: number): { vx: number; vy: number } {
  const speed = Math.hypot(vx, vy);
  if (!Number.isFinite(speed) || speed <= MAX_BALL_SPEED) {
    if (!Number.isFinite(vx) || !Number.isFinite(vy)) return { vx: 0, vy: 0 };
    return { vx, vy };
  }
  const k = MAX_BALL_SPEED / speed;
  return { vx: vx * k, vy: vy * k };
}

/** 本帧要拆成几个子步：ceil(dt / SUB_STEP_MS)，至少 1 步。 */
export function subStepsFor(dtMs: number): number {
  if (!Number.isFinite(dtMs) || dtMs <= 0) return 1;
  return Math.max(1, Math.ceil(dtMs / SUB_STEP_MS));
}

/** 球是否掉出底部。 */
export function isDrained(y: number): boolean {
  return y > DRAIN_Y;
}

/** 挡板线段：绕根部旋转，右侧关于竖轴镜像。 */
export function flipperSegment(side: FlipperSide, angleDeg: number): Segment {
  const rootX = side === "left" ? FLIP_XL : FLIP_XR;
  const rad = (angleDeg * Math.PI) / 180;
  const dir = side === "left" ? 1 : -1;
  return {
    x0: rootX,
    y0: FLIP_Y,
    x1: rootX + Math.cos(rad) * FLIP_LEN * dir,
    y1: FLIP_Y + Math.sin(rad) * FLIP_LEN,
  };
}

/** 点—线段最近点（挡板必须按线段算，不能当圆）。t 是投影位置占全长的比例。 */
export function segmentClosest(
  px: number,
  py: number,
  seg: Segment,
): { x: number; y: number; dist: number; t: number } {
  const dx = seg.x1 - seg.x0;
  const dy = seg.y1 - seg.y0;
  const lenSq = dx * dx + dy * dy;
  const raw = lenSq > 0 ? ((px - seg.x0) * dx + (py - seg.y0) * dy) / lenSq : 0;
  const t = clamp(raw, 0, 1);
  const x = seg.x0 + dx * t;
  const y = seg.y0 + dy * t;
  return { x, y, dist: Math.hypot(px - x, py - y), t };
}

/**
 * 挡板上某点的线速度（px/s）。
 * 位置 = 根部 + r·(cosθ·dir, sinθ)，对 θ 求导得到切向速度。
 * 满速抬起时尖端约 343px/s —— 这是能打出力度的来源。
 */
export function flipperPointVelocity(state: FlipperState, t: number): { vx: number; vy: number } {
  if (state.omega === 0 || !Number.isFinite(state.omega)) return { vx: 0, vy: 0 };
  const rad = (state.angle * Math.PI) / 180;
  const omegaRad = ((state.omega * Math.PI) / 180) * 1000;
  const r = FLIP_LEN * clamp(t, 0, 1);
  const dir = state.side === "left" ? 1 : -1;
  // 加 0 把 -0 归一成 0：根部（r=0）与静止时的速度必须是干净的 0。
  return {
    vx: omegaRad * r * -Math.sin(rad) * dir + 0,
    vy: omegaRad * r * Math.cos(rad) + 0,
  };
}

/**
 * 挡板是"用时间逼近目标角度"的开关：按下 → FLIP_TO，松开 → FLIP_FROM，
 * 全程 FLIP_MS 毫秒走完 52°。返回值里带本帧角速度，供碰撞算切向速度。
 */
export function stepFlipper(
  side: FlipperSide,
  angle: number,
  pressed: boolean,
  dtMs: number,
): FlipperState {
  const target = pressed ? FLIP_TO : FLIP_FROM;
  const step = max(0, dtMs);
  const delta = clamp(target - angle, -FLIP_ANGULAR_SPEED * step, FLIP_ANGULAR_SPEED * step);
  const next = clamp(angle + delta, FLIP_TO, FLIP_FROM);
  return { side, angle: next, omega: step > 0 ? (next - angle) / step : 0 };
}

/**
 * 连击倍率：900ms 内的第 1/2/3/4+ 次命中依次 ×1/×2/×4/×8。
 * 超时或首个命中都回落到 ×1。
 */
export function multiplierFor(hits: number, sinceMs: number): number {
  if (!Number.isFinite(hits) || hits < 1) return 1;
  if (!Number.isFinite(sinceMs) || sinceMs >= COMBO_WINDOW_MS) return 1;
  const step = min(Math.floor(hits) - 1, 3);
  return 2 ** step;
}

/** 缓冲器得分：基础分 × 倍率。 */
export function scoreForBumper(mult: number): number {
  if (!Number.isFinite(mult) || mult <= 0) return BUMPER_BASE;
  return Math.round(BUMPER_BASE * mult);
}

/** 圆与矩形相交（只用来判断靶标接触）。 */
export function circleHitsRect(
  cx: number,
  cy: number,
  r: number,
  box: { x: number; y: number; w: number; h: number },
): boolean {
  const nx = clamp(cx, box.x, box.x + box.w);
  const ny = clamp(cy, box.y, box.y + box.h);
  return (cx - nx) ** 2 + (cy - ny) ** 2 <= r * r;
}

/** 球当前碰到哪些靶标（下标对应 TARGETS）。 */
export function targetsInContact(x: number, y: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < TARGETS.length; i += 1) {
    const target = TARGETS[i];
    if (target && circleHitsRect(x, y, BALL_R, targetRect(target))) out.push(i);
  }
  return out;
}

/** 6 个靶标是否全部打亮。 */
export function allTargetsLit(lit: readonly boolean[]): boolean {
  if (lit.length < TARGET_COUNT) return false;
  for (let i = 0; i < TARGET_COUNT; i += 1) if (!lit[i]) return false;
  return true;
}

/** 发球位置：顶部正中。 */
export function serveBall(seed = 0): Ball {
  const dir = seed % 2 === 0 ? 1 : -1;
  return { x: FIELD_W / 2, y: BALL_MIN_Y + 4, vx: 34 * dir, vy: 20 };
}

/* ---------- 碰撞 ---------- */

/** 沿法线把球推出重叠量，并按 (1 + restitution) 反射法向速度。 */
function reflect(
  ball: Ball,
  nx: number,
  ny: number,
  penetration: number,
  restitution: number,
  surfaceVx = 0,
  surfaceVy = 0,
): void {
  ball.x += nx * penetration;
  ball.y += ny * penetration;

  const rvx = ball.vx - surfaceVx;
  const rvy = ball.vy - surfaceVy;
  const vn = rvx * nx + rvy * ny;
  if (vn >= 0) return;

  const k = 1 + restitution;
  const nvx = rvx - k * vn * nx;
  const nvy = rvy - k * vn * ny;
  ball.vx = nvx + surfaceVx;
  ball.vy = nvy + surfaceVy;
}

/** 圆—线段碰撞：挡住球并按 restitution 反射，可带表面速度（旋转中的挡板）。 */
function collideSegment(
  ball: Ball,
  seg: Segment,
  radius: number,
  restitution: number,
  state: FlipperState | null,
): boolean {
  const closest = segmentClosest(ball.x, ball.y, seg);
  const penetration = radius - closest.dist;
  if (penetration <= 0) return false;

  let nx = ball.x - closest.x;
  let ny = ball.y - closest.y;
  const len = Math.hypot(nx, ny);
  if (len < 1e-6) {
    // 球心正好落在线段上：取线段的法线，且强制朝上（把球顶出去）。
    const dx = seg.x1 - seg.x0;
    const dy = seg.y1 - seg.y0;
    const d = Math.hypot(dx, dy) || 1;
    nx = -dy / d;
    ny = dx / d;
    if (ny > 0) {
      nx = -nx;
      ny = -ny;
    }
  } else {
    nx /= len;
    ny /= len;
  }

  const sv = state ? flipperPointVelocity(state, closest.t) : { vx: 0, vy: 0 };
  reflect(ball, nx, ny, penetration, restitution, sv.vx, sv.vy);
  return true;
}

/** 圆—圆碰撞（缓冲器）：推开并沿法线弹开，系数略大于 1。 */
function collideBumper(ball: Ball, bumper: Bumper): boolean {
  const reach = bumper.r + BALL_R;
  const dx = ball.x - bumper.x;
  const dy = ball.y - bumper.y;
  const dist = Math.hypot(dx, dy);
  if (dist >= reach) return false;

  const safe = dist < 1e-6 ? 1e-6 : dist;
  const nx = dist < 1e-6 ? 0 : dx / safe;
  const ny = dist < 1e-6 ? -1 : dy / safe;
  reflect(ball, nx, ny, reach - dist, BUMPER_RESTITUTION);
  return true;
}

/** 单个子步的积分 + 碰撞。walls 放最后，保证球心绝不出界。 */
function integrate(ball: Ball, stepMs: number, flippers: readonly FlipperState[], events: BallEvent[]): void {
  const seconds = stepMs / 1000;

  ball.vy += GRAVITY * seconds;
  const clamped = clampSpeed(ball.vx, ball.vy);
  ball.vx = clamped.vx;
  ball.vy = clamped.vy;

  ball.x += ball.vx * seconds;
  ball.y += ball.vy * seconds;

  // 靶标：贴墙，只报告接触，反弹交给墙面处理。
  for (const index of targetsInContact(ball.x, ball.y)) {
    events.push({ kind: "target", index });
  }

  for (let i = 0; i < BUMPERS.length; i += 1) {
    const bumper = BUMPERS[i];
    if (bumper && collideBumper(ball, bumper)) events.push({ kind: "bumper", index: i });
  }

  for (const state of flippers) {
    const seg = flipperSegment(state.side, state.angle);
    if (collideSegment(ball, seg, BALL_R + FLIP_THICK / 2, FLIP_RESTITUTION, state)) {
      events.push({ kind: "flipper", side: state.side });
    }
  }

  for (const guide of GUIDES) {
    collideSegment(ball, guide, BALL_R + GUIDE_THICK / 2, WALL_RESTITUTION, null);
  }

  // 墙面收尾：位置夹回台内，速度按 WALL_RESTITUTION 反弹。
  if (ball.x - BALL_R < WALL_L) {
    ball.x = WALL_L + BALL_R;
    ball.vx = Math.abs(ball.vx) * WALL_RESTITUTION;
    events.push({ kind: "wall", side: "left" });
  } else if (ball.x + BALL_R > WALL_R) {
    ball.x = WALL_R - BALL_R;
    ball.vx = -Math.abs(ball.vx) * WALL_RESTITUTION;
    events.push({ kind: "wall", side: "right" });
  }

  if (ball.y - BALL_R < WALL_TOP) {
    ball.y = WALL_TOP + BALL_R;
    ball.vy = Math.abs(ball.vy) * WALL_RESTITUTION;
    events.push({ kind: "wall", side: "top" });
  }

  const capped = clampSpeed(ball.vx, ball.vy);
  ball.vx = capped.vx;
  ball.vy = capped.vy;

  if (isDrained(ball.y)) events.push({ kind: "drain" });
}

/**
 * 推进一帧：按 SUB_STEP_MS 拆子步积分（ceil(dt/4) 步）。
 * 不修改入参，返回新的球状态；碰撞事件追加到 events。
 */
export function stepBall(
  ball: Ball,
  dtMs: number,
  flippers: readonly FlipperState[] = [],
  events: BallEvent[] = [],
): Ball {
  const steps = subStepsFor(dtMs);
  const stepMs = Math.max(0, dtMs) / steps;
  const next: Ball = { x: ball.x, y: ball.y, vx: ball.vx, vy: ball.vy };

  for (let i = 0; i < steps; i += 1) {
    integrate(next, stepMs, flippers, events);
    if (isDrained(next.y)) break;
  }

  return next;
}
