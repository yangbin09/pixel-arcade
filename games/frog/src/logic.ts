/**
 * 青蛙过河纯规则层：网格、车道、浮木、跳跃、计分与落水判定。
 *
 * 不碰 DOM / Canvas，也不调用 `Math.random()`：车流与浮木的位置完全由
 * 「本局经过的毫秒数」推导（周期函数），所以车道时序、跳跃夹取、落水判定
 * 都能直接单测，重放同一段时间永远得到同一盘车流。
 */

export const CELL_W = 20;
export const CELL_H = 18;
export const COLS = 8;
export const ROWS = 11;
export const START_ROW = 0;
export const GOAL_ROW = 10;
/** 第一条河道（行 6）。行 1–5 是车道，行 6–9 是河。 */
export const RIVER_FROM = 6;
export const LIVES = 3;

/** 逻辑画布尺寸（与 meta.size 保持一致）。 */
export const WIDTH = 168;
export const HEIGHT = 210;

/** 车：16×12。 */
export const CAR_W = 16;
export const CAR_H = 12;
/** 浮木：28×16，间距 40。 */
export const LOG_W = 28;
export const LOG_H = 16;
export const LOG_GAP = 40;
/** 青蛙碰撞盒（比精灵略小，手感更宽容）。 */
export const FROG_W = 12;
export const FROG_H = 12;

export const SCORE_PER_ROW = 10;
export const GOAL_BONUS = 50;
export const ROUND_MS = 60_000;
export const START_COL = 4;

export type Dir = "up" | "down" | "left" | "right";
export type LaneKind = "car" | "log";
export type RowKind = "start" | "road" | "river" | "goal";

export interface Cell {
  col: number;
  row: number;
}

/** 车道配置：方向、速度（px/秒）、间距（px）。 */
export interface LaneSpec {
  dir: 1 | -1;
  speed: number;
  gap: number;
}

/** 车道上的一个对象；`x` 是左边缘，`index` 在同一车道内稳定（用来追踪脚下的浮木）。 */
export interface LaneObject {
  x: number;
  w: number;
  row: number;
  index: number;
}

const clampInt = (value: number, min: number, max: number): number =>
  value < min ? min : value > max ? max : value;

const mod = (value: number, span: number): number => {
  const rest = value - Math.floor(value / span) * span;
  return rest < 0 ? rest + span : rest;
};

/** 格心坐标：列 0 → x=10，列 7 → 150；行 0 → y=198，行 10 → y=18。 */
export function cellCenter(col: number, row: number): { x: number; y: number } {
  return { x: 10 + col * CELL_W, y: 198 - row * CELL_H };
}

/** 某一行的类型：起点岸 / 车道 / 河 / 终点岸。 */
export function rowKind(row: number): RowKind {
  if (row <= START_ROW) return "start";
  if (row >= GOAL_ROW) return "goal";
  if (row >= RIVER_FROM) return "river";
  return "road";
}

/** 行 1–5 是车道；其余返回 null。行 1 向右，之后逐行反向。 */
export function carLane(row: number): LaneSpec | null {
  if (row < 1 || row > 5) return null;
  return {
    dir: row % 2 === 1 ? 1 : -1,
    speed: 80 + row * 22,
    gap: 66 - row * 4,
  };
}

/** 行 6–9 是浮木带；行 6 向右、7 向左、8 向右、9 向左。 */
export function logLane(row: number): LaneSpec | null {
  if (row < RIVER_FROM || row >= GOAL_ROW) return null;
  return {
    dir: row % 2 === 0 ? 1 : -1,
    speed: 60 + (row - RIVER_FROM) * 18,
    gap: LOG_GAP,
  };
}

/** 车道对象的宽度（车 16 / 木 28）。 */
export function laneWidth(kind: LaneKind): number {
  return kind === "car" ? CAR_W : LOG_W;
}

/** 车道周期：对象宽 + 间距，位置随时间在一个周期内循环。 */
export function lanePeriod(kind: LaneKind, gap: number): number {
  return laneWidth(kind) + gap;
}

/**
 * 某条车道从开局到 `elapsedMs` 的净位移（带符号、单调、不回绕）。
 * 站在浮木上的青蛙位置写成 `laneTravel(...) + 常量` 就不会因为相位回绕而跳变。
 */
export function laneTravel(kind: LaneKind, row: number, elapsedMs: number): number {
  const lane = kind === "car" ? carLane(row) : logLane(row);
  if (!lane) return 0;
  return (lane.dir * lane.speed * Math.max(0, elapsedMs)) / 1000;
}

/** 平铺相位（0 → period），只用于摆放对象；回绕是等价重标号，不影响物理位置。 */
export function lanePhase(kind: LaneKind, row: number, elapsedMs: number): number {
  const lane = kind === "car" ? carLane(row) : logLane(row);
  if (!lane) return 0;
  const period = lanePeriod(kind, lane.gap);
  return mod(laneTravel(kind, row, elapsedMs), period);
}

/**
 * 某条车道在 `elapsedMs` 时刻的全部对象，按左边缘升序。
 * 用 `phase = travel mod period` 平铺，保证像素周期的无缝循环：
 * 一个对象从右边界完全驶出时，正好有一个新对象从左侧驶入。
 */
export function laneObjects(kind: LaneKind, row: number, elapsedMs: number): LaneObject[] {
  const lane = kind === "car" ? carLane(row) : logLane(row);
  if (!lane) return [];

  const w = laneWidth(kind);
  const period = lanePeriod(kind, lane.gap);
  const phase = lanePhase(kind, row, elapsedMs);
  const count = Math.ceil(WIDTH / period) + 2;

  const out: LaneObject[] = [];
  for (let index = 0; index < count; index += 1) {
    out.push({ x: phase - period + index * period, w, row, index });
  }
  return out;
}

/**
 * 让青蛙在 `x` 处站上哪根木头；返回 null 表示这里是间隙（会落水）。
 * 用青蛙中心点判定，比按整只青蛙算更宽容。
 */
export function logUnder(playerX: number, logs: readonly LaneObject[]): LaneObject | null {
  for (let i = 0; i < logs.length; i += 1) {
    const log = logs[i]!;
    if (playerX >= log.x && playerX <= log.x + log.w) return log;
  }
  return null;
}

/** 是否踩在浮木上（规格要求的导出）。 */
export function isOnLog(playerX: number, logs: readonly LaneObject[]): boolean {
  return logUnder(playerX, logs) !== null;
}

/** 车与青蛙的横向碰撞：矩形相交，行由调用方保证。 */
export function carHitsPlayer(playerX: number, cars: readonly LaneObject[]): boolean {
  const half = FROG_W / 2;
  const left = playerX - half;
  const right = playerX + half;
  for (let i = 0; i < cars.length; i += 1) {
    const car = cars[i]!;
    if (right > car.x && left < car.x + car.w) return true;
  }
  return false;
}

/** 横向超出画布 = 被浮木带出河面。 */
export function isOutOfCanvas(playerX: number): boolean {
  return playerX < 0 || playerX > WIDTH;
}

/** 连续像素坐标 → 所在列（夹到 0–7）。 */
export function colForX(playerX: number): number {
  return clampInt(Math.round((playerX - CELL_W / 2) / CELL_W), 0, COLS - 1);
}

/** 列 → 该列的格心 x。 */
export function xForCol(col: number): number {
  return cellCenter(clampInt(col, 0, COLS - 1), START_ROW).x;
}

/** 一次跳跃移动一格，夹在 [0,COLS-1] / [0,ROWS-1] 内。 */
export function movePlayer(pos: Cell, dir: Dir): Cell {
  const col = clampInt(pos.col, 0, COLS - 1);
  const row = clampInt(pos.row, 0, ROWS - 1);
  if (dir === "left") return { col: clampInt(col - 1, 0, COLS - 1), row };
  if (dir === "right") return { col: clampInt(col + 1, 0, COLS - 1), row };
  if (dir === "up") return { col, row: clampInt(row + 1, 0, ROWS - 1) };
  return { col, row: clampInt(row - 1, 0, ROWS - 1) };
}

/** 只在刷新最远行时给分：同行、后退都给 0。 */
export function advanceScore(prevBestRow: number, newRow: number): number {
  return newRow > prevBestRow ? SCORE_PER_ROW : 0;
}

/** 结算用的「最远行」推进（只升不降）。 */
export function nextBestRow(prevBestRow: number, newRow: number): number {
  return Math.max(prevBestRow, newRow);
}

/**
 * 触屏点击 → 跳跃方向：按相对青蛙的主轴决定，点在自己身上就是向前跳。
 * 这条通路让「点哪跳哪」在手机上成立，键盘则用方向键。
 */
export function dirFromTap(tapX: number, tapY: number, frogX: number, frogY: number): Dir {
  const dx = tapX - frogX;
  const dy = tapY - frogY;
  if (Math.abs(dx) < 4 && Math.abs(dy) < 4) return "up";
  if (Math.abs(dx) > Math.abs(dy)) return dx >= 0 ? "right" : "left";
  return dy >= 0 ? "down" : "up";
}

/** 跳跃动画的插值：起跳点 → 落点 + 一个像素拱形。 */
export function hopPosition(
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  t: number,
): { x: number; y: number; lift: number } {
  const k = t < 0 ? 0 : t > 1 ? 1 : t;
  const lift = Math.round(Math.sin(k * Math.PI) * 4);
  return {
    x: fromX + (toX - fromX) * k,
    y: fromY + (toY - fromY) * k - lift,
    lift,
  };
}
