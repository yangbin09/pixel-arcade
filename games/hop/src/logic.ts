/**
 * 青蛙过河纯规则层：行类型表、车道速度、坐标互转、木头带人位移、计分。
 *
 * 不碰 DOM / Canvas，随机源由调用方注入，
 * 所以「木头带人」「水里没木头」「坐标互转」都能直接单测。
 */

export type RowKind = "home" | "water" | "safe" | "road" | "start";

export type LaneKind = "water" | "road";

/** 一条车道：行号 + 类型 + 基础速度（px/s，正数向右）。 */
export interface LaneSpec {
  row: number;
  kind: LaneKind;
  baseSpeed: number;
}

/** 车道上的木头 / 汽车。x 是左边缘，可以是负数（从屏幕外驶入）。 */
export interface TrafficObject {
  row: number;
  x: number;
  w: number;
  /** px/s，正数向右。 */
  speed: number;
  /** 外观变体：绘制层用来挑颜色 / 纹理，规则层不关心。 */
  kind: number;
}

export const COLS = 7;
export const ROWS = 8;
export const CELL = 24;
/** 棋盘宽度 = 7 × 24 = 168，和画布同宽。 */
export const WIDTH = COLS * CELL;
/** 8 行占用的高度 = 192；画布 210，剩下 18px 是底部河岸装饰。 */
export const BOARD_H = ROWS * CELL;

export const HOME_ROW = 0;
export const START_ROW = ROWS - 1;
/** 起点列：正中间，和街机青蛙一致。 */
export const START_COL = 3;
export const MAX_LIVES = 3;

/** 首次到达任意一行（非对岸）的分数。 */
export const ROW_POINTS = 10;
/** 到达对岸的分数，每次过河都给。 */
export const HOME_POINTS = 100;

/** 青蛙碰撞体的半宽。 */
export const FROG_HALF = 7;

/**
 * 站木头的宽容度：青蛙身体边缘搭到木头也算站住。
 * 只用中心点判定的话，手感会「看起来明明踩着却掉水里」。
 */
export const LOG_GRACE = 3;

/** 木头宽度档位：2 格 / 3 格。 */
export const LOG_WIDTHS: readonly number[] = [48, 72];
/** 汽车宽度档位。 */
export const CAR_WIDTHS: readonly number[] = [20, 24, 36];

/** 水位 1、2 行与车道 4、5 行；方向一右一左交替。 */
export const LANES: readonly LaneSpec[] = [
  { row: 1, kind: "water", baseSpeed: 34 },
  { row: 2, kind: "water", baseSpeed: -30 },
  { row: 4, kind: "road", baseSpeed: 48 },
  { row: 5, kind: "road", baseSpeed: -42 },
];

/** 每升一级车道加速的幅度（px/s）。 */
const SPEED_STEP = 8;
/** 车道等级上限。 */
export const MAX_LEVEL = 5;

const ROW_KINDS: readonly RowKind[] = [
  "home",
  "water",
  "water",
  "safe",
  "road",
  "road",
  "safe",
  "start",
];

const clampNumber = (value: number, min: number, max: number): number =>
  value < min ? min : value > max ? max : value;

/** 行号取整并夹在 0..ROWS-1。 */
export function clampRow(row: number): number {
  const n = Math.round(Number.isFinite(row) ? row : 0);
  return n < 0 ? 0 : n > ROWS - 1 ? ROWS - 1 : n;
}

/** 列号取整并夹在 0..COLS-1（越界夹住，不越界）。 */
export function clampCol(col: number): number {
  const n = Math.round(Number.isFinite(col) ? col : 0);
  return n < 0 ? 0 : n > COLS - 1 ? COLS - 1 : n;
}

/** 竖直方向：行号 → 行类型。越界行夹到边界行。 */
export function rowKind(row: number): RowKind {
  return ROW_KINDS[clampRow(row)] ?? "start";
}

export function isWaterRow(row: number): boolean {
  return rowKind(row) === "water";
}

/**
 * 车道速度（px/s）：正数向右，负数向左；等级越高越快。
 * 非车道行返回 0。
 */
export function laneSpeed(row: number, level = 1): number {
  const lane = LANES.find((item) => item.row === clampRow(row));
  if (!lane) return 0;
  const lv = clampNumber(Number.isFinite(level) ? Math.floor(level) : 1, 1, MAX_LEVEL);
  const boost = (lv - 1) * SPEED_STEP;
  return lane.baseSpeed >= 0 ? lane.baseSpeed + boost : lane.baseSpeed - boost;
}

/** 网格 → 逻辑像素（返回格子左上角）。 */
export function gridToPx(col: number, row: number): { x: number; y: number } {
  return { x: clampCol(col) * CELL, y: clampRow(row) * CELL };
}

/** 逻辑像素 → 网格（向下取整，越界夹回棋盘）。 */
export function pxToGrid(x: number, y: number): { col: number; row: number } {
  const px = Number.isFinite(x) ? x : 0;
  const py = Number.isFinite(y) ? y : 0;
  return { col: clampCol(Math.floor(px / CELL)), row: clampRow(Math.floor(py / CELL)) };
}

/** 格子中心（青蛙站位）。 */
export function cellCenter(col: number, row: number): { x: number; y: number } {
  return { x: clampCol(col) * CELL + CELL / 2, y: clampRow(row) * CELL + CELL / 2 };
}

/** 列 → 青蛙中心 x。 */
export function playerXForCol(col: number): number {
  return clampCol(col) * CELL + CELL / 2;
}

/** 青蛙中心 x → 列。 */
export function colForX(x: number): number {
  const px = Number.isFinite(x) ? x : 0;
  return clampCol(Math.floor(px / CELL));
}

/** 青蛙中心 x 夹在棋盘内，保证整只青蛙不出画面。 */
export function clampX(x: number): number {
  if (!Number.isFinite(x)) return CELL / 2;
  return clampNumber(x, CELL / 2, WIDTH - CELL / 2);
}

/**
 * 站在木头上被带走的水平位移（px）。
 * 纯函数：位移只跟木头速度与经过时间有关，和帧率无关。
 */
export function rideDelta(wood: { speed: number }, dtMs: number): number {
  const dt = Number.isFinite(dtMs) && dtMs > 0 ? dtMs : 0;
  const speed = Number.isFinite(wood.speed) ? wood.speed : 0;
  return (speed * dt) / 1000;
}

/** 行进度：起点 0、对岸 ROWS-1，用来显示「最远行」。 */
export function rowProgress(row: number): number {
  return ROWS - 1 - clampRow(row);
}

/** 过河次数 → 车道等级：每过 2 次升 1 级，最高 5 级。 */
export function levelFor(crossings: number): number {
  const n = Number.isFinite(crossings) ? Math.max(0, Math.floor(crossings)) : 0;
  return Math.min(MAX_LEVEL, 1 + Math.floor(n / 2));
}

/** 到达某一行值多少分：对岸 100，其余行 10，非法行 0。 */
export function scoreForRow(row: number): number {
  const r = clampRow(row);
  if (r === HOME_ROW) return HOME_POINTS;
  if (r === START_ROW) return 0;
  return ROW_POINTS;
}

/** 该行是否第一次到达（首次才计分，重复访问不计）。 */
export function isFirstVisit(visited: readonly boolean[], row: number): boolean {
  return visited[clampRow(row)] !== true;
}

/**
 * 铺一条车道：从屏幕外开始按随机间距摆木头 / 汽车。
 * 间距一定大于青蛙宽度，保证有落脚空间。
 */
export function createLane(
  row: number,
  level: number,
  kind: LaneKind,
  rng: () => number = Math.random,
): TrafficObject[] {
  const speed = laneSpeed(row, level);
  if (speed === 0) return [];

  const widths = kind === "water" ? LOG_WIDTHS : CAR_WIDTHS;
  const gapMin = kind === "water" ? 40 : 46;
  const gapMax = kind === "water" ? 58 : 72;
  const limit = WIDTH + CELL * 2;
  const out: TrafficObject[] = [];

  let x = -Math.floor(randomUnit(rng) * CELL * 2);
  let guard = 0;
  while (x < limit && guard < 32) {
    guard += 1;
    const w = widths[pickIndex(rng, widths.length)] as number;
    out.push({ row, x, w, speed, kind: pickIndex(rng, 4) });
    x += w + gapMin + randomUnit(rng) * (gapMax - gapMin);
  }
  return out;
}

/** rng 可能返回 1 / NaN，统一夹成 [0, 1) 的合法比例。 */
function randomUnit(rng: () => number): number {
  const value = rng();
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.min(0.999999, value);
}

/** 按 rng 从 0..length-1 里取一个整数下标。 */
function pickIndex(rng: () => number, length: number): number {
  if (length <= 0) return 0;
  return Math.floor(randomUnit(rng) * length);
}

/** 木头 / 车按速度前进，出界后从另一侧回卷。原地修改数组里的对象。 */
export function stepObjects(
  objects: TrafficObject[],
  dtMs: number,
  width = WIDTH,
): void {
  const dt = Number.isFinite(dtMs) && dtMs > 0 ? dtMs : 0;
  for (const item of objects) {
    item.x += (item.speed * dt) / 1000;
    if (item.speed > 0 && item.x > width) item.x = -item.w;
    else if (item.speed < 0 && item.x + item.w < 0) item.x = width;
  }
}

/** 该行是否有车压到青蛙（水平重叠即命中）。 */
export function carHitsPlayer(
  playerX: number,
  row: number,
  cars: readonly TrafficObject[],
): boolean {
  const left = playerX - FROG_HALF;
  const right = playerX + FROG_HALF;
  for (const car of cars) {
    if (car.row !== row) continue;
    if (right > car.x && left < car.x + car.w) return true;
  }
  return false;
}

/**
 * 青蛙脚下（中心点）是哪根木头。
 * grace > 0 时把木头的左右边界各向外放宽 grace 像素，
 * 让青蛙擦着木头边也能站住（游戏里用这个手感更宽容）。
 * 在边缘外或别的行返回 null。
 */
export function logUnder(
  playerX: number,
  row: number,
  logs: readonly TrafficObject[],
  grace = 0,
): TrafficObject | null {
  const pad = Number.isFinite(grace) ? Math.max(0, grace) : 0;
  for (const log of logs) {
    if (log.row !== row) continue;
    if (playerX >= log.x + 1 - pad && playerX <= log.x + log.w - 1 + pad) return log;
  }
  return null;
}

/** 一帧水上结算的结果。 */
export interface WaterStep {
  /** 结算后的青蛙中心 x（踩空时保持原位）。 */
  x: number;
  /** 是否踩到了木头；false 表示落水。 */
  onLog: boolean;
  /** 踩到的那根木头，踩空为 null。 */
  log: TrafficObject | null;
}

/**
 * 水上每帧结算：踩到木头就跟着漂（位移 = rideDelta），
 * 踩空则 onLog=false，调用方必须扣命。
 * 这是本作最核心的机制，所以放在纯逻辑层直接单测。
 */
export function stepOnWater(
  playerX: number,
  row: number,
  logs: readonly TrafficObject[],
  dtMs: number,
  grace = 0,
): WaterStep {
  const log = logUnder(playerX, row, logs, grace);
  if (!log) return { x: clampX(playerX), onLog: false, log: null };
  return { x: clampX(playerX + rideDelta(log, dtMs)), onLog: true, log };
}
