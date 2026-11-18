/**
 * 打砖块纯规则层。
 *
 * 只处理几何常量、关卡图案、挡板反弹角、AABB 与子步进计算，
 * 不碰 DOM / Canvas，因此可以直接单测。
 */

export const FIELD_W = 168;
export const FIELD_H = 210;

/** HUD 之外预留的顶部空白。 */
export const TOP_PAD = 20;

/* ---------------- 砖块 ---------------- */

export const BRICK_COLS = 8;
export const BRICK_ROWS = 5;
export const BRICK_W = 18;
export const BRICK_H = 8;
export const BRICK_GAP = 2;

export const BRICK_FIELD_W = BRICK_COLS * BRICK_W + (BRICK_COLS - 1) * BRICK_GAP;
/** 158 宽的砖区在 168 画布里居中，左右各留 5px。 */
export const BRICK_ORIGIN_X = Math.floor((FIELD_W - BRICK_FIELD_W) / 2);
export const BRICK_ORIGIN_Y = TOP_PAD;

/* ---------------- 挡板 / 球 ---------------- */

export const PADDLE_W = 28;
export const PADDLE_WIDE = 42;
export const PADDLE_H = 4;
export const PADDLE_Y = 196;
export const PADDLE_MARGIN = 6;
export const PADDLE_SPEED = 220;

export const BALL_R = 1.5;
export const BASE_SPEED = 120;
export const MAX_SPEED = 240;
/** 每个子步最多走 4px，避免高速穿砖。 */
export const MAX_STEP = 4;
/** 挡板边缘对应 ±60°。 */
export const MAX_BOUNCE_ANGLE = Math.PI / 3;

/* ---------------- 一局 ---------------- */

export const LIVES = 3;
export const TOTAL_LEVELS = 3;

/* ---------------- 道具 ---------------- */

export const POWERUP_SIZE = 7;
export const POWERUP_FALL = 60;
/** 每打碎 6 块砖掷一次骰子。 */
export const POWERUP_EVERY = 6;
export const POWERUP_CHANCE = 0.2;
export const WIDE_MS = 8000;

export const POWERUP_KINDS: readonly PowerUpKind[] = ["wide", "multi", "life"];

export type PowerUpKind = "wide" | "multi" | "life";

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Brick {
  row: number;
  col: number;
  alive: boolean;
}

export interface Ball {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** 本关固定球速，反弹只改方向不改大小。 */
  speed: number;
  dead: boolean;
}

export interface PowerUp {
  x: number;
  y: number;
  kind: PowerUpKind;
}

/** 某块砖的矩形（列先、行后，和数组布局一致）。 */
export function brickRect(row: number, col: number): Rect {
  return {
    x: BRICK_ORIGIN_X + col * (BRICK_W + BRICK_GAP),
    y: BRICK_ORIGIN_Y + row * (BRICK_H + BRICK_GAP),
    w: BRICK_W,
    h: BRICK_H,
  };
}

/** 顶行 30、中间三行 20、底行 10。 */
export function brickPoints(row: number): number {
  if (row <= 0) return 30;
  if (row >= BRICK_ROWS - 1) return 10;
  return 20;
}

/**
 * 三关图案：满盘 / 棋盘 / 金字塔。
 * 返回 5×8 的布尔矩阵，true 表示这一格有砖。
 */
export function levelLayout(level: number): boolean[][] {
  const stage = Math.max(1, Math.min(TOTAL_LEVELS, Math.floor(level)));
  const widths = [2, 4, 6, 8, 8];
  const rows: boolean[][] = [];

  for (let row = 0; row < BRICK_ROWS; row += 1) {
    const width = widths[row] ?? BRICK_COLS;
    const offset = Math.floor((BRICK_COLS - width) / 2);
    const line: boolean[] = [];

    for (let col = 0; col < BRICK_COLS; col += 1) {
      if (stage === 1) line.push(true);
      else if (stage === 2) line.push((row + col) % 2 === 0);
      else line.push(col >= offset && col < offset + width);
    }
    rows.push(line);
  }

  return rows;
}

/** 按关卡图案生成砖块对象，只包含实际存在的砖。 */
export function createBricks(level: number): Brick[] {
  const out: Brick[] = [];
  levelLayout(level).forEach((line, row) => {
    line.forEach((present, col) => {
      if (present) out.push({ row, col, alive: true });
    });
  });
  return out;
}

export function countAlive(bricks: readonly Brick[]): number {
  let total = 0;
  for (const brick of bricks) if (brick.alive) total += 1;
  return total;
}

/** 每关 +12%，上限 240px/s。 */
export function speedForLevel(level: number): number {
  const stage = Math.max(1, Math.floor(level));
  return Math.min(MAX_SPEED, BASE_SPEED * Math.pow(1.12, stage - 1));
}

/**
 * 挡板反弹：offset 为击中点相对挡板中心的归一化位置（-1..1），
 * 对应 -60°..+60°，速度大小保持不变。
 */
export function bounceFromPaddle(offset: number, speed: number): { vx: number; vy: number } {
  const clamped = Math.max(-1, Math.min(1, offset));
  const angle = clamped * MAX_BOUNCE_ANGLE;
  return { vx: Math.sin(angle) * speed, vy: -Math.cos(angle) * speed };
}

export function paddleMaxX(width = PADDLE_W): number {
  return FIELD_W - PADDLE_MARGIN - width;
}

export function clampPaddleX(x: number, width = PADDLE_W): number {
  const min = PADDLE_MARGIN;
  const max = Math.max(min, paddleMaxX(width));
  return Math.max(min, Math.min(max, x));
}

/** 触摸相对拖动的灵敏度：手指横移 1px，挡板走 1.35px。 */
export const DRAG_SENSITIVITY = 1.35;

/** 一次触摸拖动的锚点：手指起点 + 按下瞬间的挡板左边缘。 */
export interface TouchDragAnchor {
  startX: number;
  paddleX: number;
}

/** 记录触摸拖动锚点，不移动挡板（按下只负责发球）。 */
export function touchDragAnchor(pointerX: number, paddleX: number): TouchDragAnchor {
  return { startX: pointerX, paddleX };
}

/** 相对拖动目标：锚点 + 手指横移 × 灵敏度，再按当前挡板宽度夹进场地。 */
export function touchDragTarget(
  anchor: TouchDragAnchor,
  pointerX: number,
  width = PADDLE_W,
  sensitivity = DRAG_SENSITIVITY,
): number {
  return clampPaddleX(anchor.paddleX + (pointerX - anchor.startX) * sensitivity, width);
}

export function paddleRect(x: number, width: number, y = PADDLE_Y): Rect {
  return { x, y, w: width, h: PADDLE_H };
}

/** 球的 AABB：半径 1.5 的圆按 3×3 方块处理。 */
export function ballBox(cx: number, cy: number, r = BALL_R): Rect {
  return { x: cx - r, y: cy - r, w: r * 2, h: r * 2 };
}

export function overlap(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

/**
 * 本帧需要拆成几个子步：每步位移不超过 maxStep 像素。
 * 球速 240px/s、dt 50ms 时是 3 步（每步 4px）。
 */
export function substepsFor(distance: number, maxStep = MAX_STEP): number {
  if (!Number.isFinite(distance) || distance <= 0) return 1;
  const step = Math.max(1, maxStep);
  return Math.max(1, Math.ceil(distance / step));
}
