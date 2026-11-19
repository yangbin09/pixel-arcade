/**
 * 泡泡龙的纯规则层：蜂窝网格几何、奇偶行邻居、吸附落位、同色连通块、
 * 断连掉落、计分与子步进。
 *
 * 不碰 DOM / Canvas，也**不调用 Math.random()**：随机源必须由调用方注入
 * （`createGrid(rng)` / `randomColor(rng)`），所以单测可以完全复现。
 */

/* ---------------- 画布与蜂窝尺寸 ---------------- */

export const FIELD_W = 168;
export const FIELD_H = 210;

/** 泡泡半径 8，直径 16。 */
export const RADIUS = 8;
export const DIAMETER = RADIUS * 2;

/** 行高 = 16 × sqrt(3)/2，规格取 13.86。 */
export const ROW_H = 13.86;

/** 偶数行 8 列，奇数行 7 列（奇数行整体右移半个直径）。 */
export const COLS_EVEN = 8;
export const COLS_ODD = 7;

/** 最多 11 行：最后一行中心 y = 8 + 10 × 13.86 = 146.6，炮台在 194。 */
export const ROWS_MAX = 11;

/** 蜂窝整体的像素宽度：7 个列距 + 左右两个半径 = 112 + 16。 */
export const GRID_W = (COLS_EVEN - 1) * DIAMETER + DIAMETER;

/**
 * 蜂窝横坐标原点（偶数行第 0 列的中心 x）。
 *
 * ⚠️ 与规格的一处**有意偏离**：规格写 `x = 8 + col*16 + (row%2)*8`，
 * 那组数字是按 136 宽的画布推出来的（8 + 8×16 = 136），画布一换成 168 宽，
 * 整块蜂窝就会挤在左边、右侧空出 32px，视觉上明显偏。
 *
 * 这里只把原点改成让蜂窝水平居中：`(168 - 128) / 2 + 8 = 28`，
 * **行高 13.86、列距 16、奇数行 +8 偏移全部保持规格原值**，
 * 单测钉住「左右留白对称、最右列不越界」。
 */
export const ORIGIN_X = (FIELD_W - GRID_W) / 2 + RADIUS;
export const ORIGIN_Y = 8;

/** 开局预填 5 行。 */
export const PREFILL_ROWS = 5;

/** 一局 40 发。 */
export const SHOTS = 40;

/** 球速 220 px/s；每 4ms 一个子步，防止穿透。 */
export const SPEED = 220;
export const SUBSTEP_MS = 4;

/** 炮台左右可移动范围（球心）与所在高度。 */
export const CANNON_MIN = RADIUS;
export const CANNON_MAX = FIELD_W - RADIUS;
export const CANNON_SPEED = 120;
export const CANNON_Y = 194;

/** 泡泡压到这一行就判负。 */
export const DANGER_ROW = ROWS_MAX - 1;

/** 计分：整块消除 20/颗，断连掉落 10/颗，清空全场额外 +200。 */
export const CLEAR_POINTS = 20;
export const DROP_POINTS = 10;
export const CLEAR_BONUS = 200;

/** 4 色泡泡；art.ts 里按同样的下标取调色板颜色。 */
export const COLOR_COUNT = 4;

export interface Cell {
  col: number;
  row: number;
}

/** 网格：固定 ROWS_MAX 行，每行都是 COLS_EVEN 长；奇数列的第 8 格永远是 null。 */
export type Grid = (number | null)[][];

const cellKey = (col: number, row: number): string => `${col},${row}`;

const finite = (value: number, fallback = 0): number =>
  Number.isFinite(value) ? value : fallback;

/* ---------------- 蜂窝几何 ---------------- */

/** 该行有几个合法列。偶数行 8 列，奇数行 7 列。 */
export function colsInRow(row: number): number {
  return ((row % 2) + 2) % 2 === 0 ? COLS_EVEN : COLS_ODD;
}

/** 列 / 行是否落在蜂窝内（负行、越界列、奇数列第 8 格都算非法）。 */
export function isValidCell(col: number, row: number): boolean {
  if (!Number.isInteger(col) || !Number.isInteger(row)) return false;
  if (row < 0 || row >= ROWS_MAX) return false;
  return col >= 0 && col < colsInRow(row);
}

/** 格子中心的逻辑像素坐标。 */
export function hexCenter(col: number, row: number): { x: number; y: number } {
  const odd = ((row % 2) + 2) % 2;
  return {
    x: ORIGIN_X + col * DIAMETER + odd * RADIUS,
    y: ORIGIN_Y + row * ROW_H,
  };
}

/** 偶数行的六个邻居偏移（规格原序）。 */
const EVEN_OFFSETS: readonly (readonly [number, number])[] = [
  [-1, 0],
  [1, 0],
  [0, -1],
  [-1, -1],
  [0, 1],
  [-1, 1],
];

/** 奇数行的六个邻居偏移：上半行整体右移一格（规格原序）。 */
const ODD_OFFSETS: readonly (readonly [number, number])[] = [
  [-1, 0],
  [1, 0],
  [1, -1],
  [0, -1],
  [1, 1],
  [0, 1],
];

/** 六个相邻格，边界外的不返回。奇偶行的偏移不同，这是本作最容易写错的地方。 */
export function hexNeighbors(col: number, row: number): Cell[] {
  const offsets = ((row % 2) + 2) % 2 === 0 ? EVEN_OFFSETS : ODD_OFFSETS;
  const out: Cell[] = [];
  for (const [dx, dy] of offsets) {
    const next: Cell = { col: col + dx, row: row + dy };
    if (isValidCell(next.col, next.row)) out.push(next);
  }
  return out;
}

/**
 * 撞左 / 右墙后速度取反。竖直发射时 vx 恒为 0，这里返回 0——
 * 保留完整实现是为了贴墙那一帧不会被漏掉（也为以后加瞄准角度留口子）。
 */
export function reflectAngle(vx: number, x: number): number {
  const speed = finite(vx);
  if (speed === 0) return 0;
  if (x - RADIUS <= 0 && speed < 0) return Math.abs(speed);
  if (x + RADIUS >= FIELD_W && speed > 0) return -Math.abs(speed);
  return speed;
}

/** 把坐标吸附到最近的格子中心（纯几何，不看网格占用）。 */
export function snapToGrid(x: number, y: number): Cell {
  const px = finite(x);
  const py = finite(y);
  let best: Cell = { col: 0, row: 0 };
  let bestDist = Number.POSITIVE_INFINITY;

  for (let row = 0; row < ROWS_MAX; row += 1) {
    const cols = colsInRow(row);
    for (let col = 0; col < cols; col += 1) {
      const center = hexCenter(col, row);
      const dx = center.x - px;
      const dy = center.y - py;
      const dist = dx * dx + dy * dy;
      if (dist < bestDist) {
        bestDist = dist;
        best = { col, row };
      }
    }
  }
  return best;
}

/* ---------------- 网格读写 ---------------- */

/** 取格子颜色下标；空格 / 越界 / 空行统一返回 null（0 是合法颜色，别用真假判断）。 */
export function cellColor(grid: Grid, col: number, row: number): number | null {
  if (!isValidCell(col, row)) return null;
  const line = grid[row];
  if (!line) return null;
  const color = line[col];
  return typeof color === "number" ? color : null;
}

/** 这一格是否为空（且合法）。 */
export function isEmptyCell(grid: Grid, col: number, row: number): boolean {
  return isValidCell(col, row) && cellColor(grid, col, row) === null;
}

/** 落子；非法格或已占用返回 false。 */
export function insertBubble(
  grid: Grid,
  col: number,
  row: number,
  color: number,
): boolean {
  if (!isEmptyCell(grid, col, row)) return false;
  const line = grid[row];
  if (!line) return false;
  line[col] = color;
  return true;
}

/** 批量清空格子。 */
export function removeCells(grid: Grid, cells: readonly Cell[]): void {
  for (const cell of cells) {
    const line = grid[cell.row];
    if (!line || !isValidCell(cell.col, cell.row)) continue;
    line[cell.col] = null;
  }
}

/** 场上还剩几颗泡泡。 */
export function countBubbles(grid: Grid): number {
  let total = 0;
  for (let row = 0; row < ROWS_MAX; row += 1) {
    const cols = colsInRow(row);
    for (let col = 0; col < cols; col += 1) {
      if (cellColor(grid, col, row) !== null) total += 1;
    }
  }
  return total;
}

/** 全场清空。 */
export function isCleared(grid: Grid): boolean {
  return countBubbles(grid) === 0;
}

/** 最下面还有泡泡的那一行；全空返回 -1。用来判断「压到底线」。 */
export function lowestOccupiedRow(grid: Grid): number {
  for (let row = ROWS_MAX - 1; row >= 0; row -= 1) {
    const cols = colsInRow(row);
    for (let col = 0; col < cols; col += 1) {
      if (cellColor(grid, col, row) !== null) return row;
    }
  }
  return -1;
}

/* ---------------- 随机（源由调用方注入） ---------------- */

/** 从 4 色里抽一个颜色下标；rng 越界（1 / NaN）也夹回 [0, COLOR_COUNT)。 */
export function randomColor(rng: () => number, colors = COLOR_COUNT): number {
  const count = Math.max(1, Math.floor(finite(colors, COLOR_COUNT)));
  const roll = finite(rng(), 0);
  const safe = Math.min(Math.max(roll, 0), 0.999999);
  return Math.floor(safe * count);
}

/** 开局网格：预填 5 行，颜色由 rng 抽。同一个 rng 序列跑出同一盘。 */
export function createGrid(rng: () => number): Grid {
  const grid: Grid = [];
  for (let row = 0; row < ROWS_MAX; row += 1) {
    const line: (number | null)[] = [];
    for (let col = 0; col < COLS_EVEN; col += 1) line.push(null);
    grid.push(line);
  }

  for (let row = 0; row < PREFILL_ROWS; row += 1) {
    const cols = colsInRow(row);
    for (let col = 0; col < cols; col += 1) {
      insertBubble(grid, col, row, randomColor(rng));
    }
  }
  return grid;
}

/* ---------------- 连通块 / 掉落 ---------------- */

/** 同色连通块（含起点自己）；起点是空格时返回空数组。 */
export function sameColorCluster(grid: Grid, col: number, row: number): Cell[] {
  const color = cellColor(grid, col, row);
  if (color === null) return [];

  const seen = new Set<string>([cellKey(col, row)]);
  const stack: Cell[] = [{ col, row }];
  const out: Cell[] = [];

  while (stack.length > 0) {
    const cell = stack.pop() as Cell;
    out.push(cell);
    for (const next of hexNeighbors(cell.col, cell.row)) {
      const key = cellKey(next.col, next.row);
      if (seen.has(key)) continue;
      if (cellColor(grid, next.col, next.row) !== color) continue;
      seen.add(key);
      stack.push(next);
    }
  }

  // 固定顺序（行优先），方便单测与逐颗播放动画。
  out.sort((a, b) => a.row - b.row || a.col - b.col);
  return out;
}

/**
 * 与顶部（第 0 行）不连通的泡泡整串掉落。
 * 第 0 行只要有泡泡就一定「连着顶」，永远不算掉落。
 */
export function detachedFromCeiling(grid: Grid): Cell[] {
  const connected = new Set<string>();
  const stack: Cell[] = [];

  const topCols = colsInRow(0);
  for (let col = 0; col < topCols; col += 1) {
    if (cellColor(grid, col, 0) === null) continue;
    connected.add(cellKey(col, 0));
    stack.push({ col, row: 0 });
  }

  while (stack.length > 0) {
    const cell = stack.pop() as Cell;
    for (const next of hexNeighbors(cell.col, cell.row)) {
      const key = cellKey(next.col, next.row);
      if (connected.has(key)) continue;
      if (cellColor(grid, next.col, next.row) === null) continue;
      connected.add(key);
      stack.push(next);
    }
  }

  const out: Cell[] = [];
  for (let row = 0; row < ROWS_MAX; row += 1) {
    const cols = colsInRow(row);
    for (let col = 0; col < cols; col += 1) {
      if (cellColor(grid, col, row) === null) continue;
      if (!connected.has(cellKey(col, row))) out.push({ col, row });
    }
  }
  return out;
}

/**
 * 落位格：贴着落点最近的那个空格。
 * 几何吸附到的格子若已被占，就从它出发在空格里 BFS，取离落点最近的空格。
 */
export function landingCell(grid: Grid, x: number, y: number): Cell | null {
  const px = finite(x);
  const py = finite(y);
  const start = snapToGrid(px, py);
  if (isEmptyCell(grid, start.col, start.row)) return start;

  let best: Cell | null = null;
  let bestDist = Number.POSITIVE_INFINITY;
  const visited = new Set<string>([cellKey(start.col, start.row)]);
  const queue: Cell[] = [start];

  for (let head = 0; head < queue.length; head += 1) {
    const cell = queue[head] as Cell;
    for (const next of hexNeighbors(cell.col, cell.row)) {
      const key = cellKey(next.col, next.row);
      if (visited.has(key)) continue;
      visited.add(key);
      if (!isEmptyCell(grid, next.col, next.row)) continue;

      const center = hexCenter(next.col, next.row);
      const dx = center.x - px;
      const dy = center.y - py;
      const dist = dx * dx + dy * dy;
      if (dist < bestDist) {
        bestDist = dist;
        best = next;
      }
      queue.push(next);
    }
  }
  return best;
}

/* ---------------- 计分 / 玩法辅助 ---------------- */

/** 整块消除：20 × n。 */
export function scoreForClear(n: number): number {
  return Math.max(0, Math.floor(finite(n))) * CLEAR_POINTS;
}

/** 断连掉落：10 × n。 */
export function scoreForDrop(n: number): number {
  return Math.max(0, Math.floor(finite(n))) * DROP_POINTS;
}

/** 炮台位置夹在 [8, 160]。 */
export function clampCannon(x: number): number {
  const value = finite(x, FIELD_W / 2);
  return value < CANNON_MIN ? CANNON_MIN : value > CANNON_MAX ? CANNON_MAX : value;
}

/** 本帧拆成几个子步：每步不超过 SUBSTEP_MS 毫秒。 */
export function substepsFor(dtMs: number): number {
  const ms = finite(dtMs);
  if (ms <= 0) return 1;
  return Math.max(1, Math.ceil(ms / SUBSTEP_MS));
}

/**
 * 一次发弹后，下颗泡泡与「手上这颗」互换（B 键 / 手柄 B）。
 * 纯函数：返回互换后的 [手上, 下一颗]。
 */
export function swapColors(current: number, next: number): [number, number] {
  return [next, current];
}
