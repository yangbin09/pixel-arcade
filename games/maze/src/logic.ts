/**
 * 迷雾迷宫纯规则层：迷宫生成、可达性、迷雾视野、钥匙摆放、探索度。
 *
 * 不碰 DOM / Canvas，随机源由调用方注入，
 * 所以「同种子同迷宫」「起点到出口可达」「视野不穿墙」都能直接单测。
 */

/** 逻辑格子 13×15（奇数列/行是走廊，偶数行列是墙）。 */
export const COLS = 13;
export const ROWS = 15;
/** 每格 12 逻辑像素，棋盘实际 156×180。 */
export const CELL = 12;
/**
 * 棋盘左上角原点。
 *
 * 规格写的是 `(6, 6)`，但同一节又要求「156×180 垂直居中」；
 * 画布高 210、棋盘高 180 时居中偏移只能是 `(210 − 180) / 2 = 15`，
 * 因此这里取 `(6, 15)` 以满足居中（宽度 156 + 左右各 6 正好对称）。
 */
export const ORIGIN = { x: 6, y: 15 } as const;
/** 迷雾半径：切比雪夫距离 ≤ 3 格，且不穿墙。 */
export const VIEW_RADIUS = 3;
/** 三把钥匙。 */
export const KEYS = 3;

/** 起点固定左上角 (1, 1)；出口在右下角。 */
export const START = { col: 1, row: 1 } as const;
export const EXIT = { col: COLS - 2, row: ROWS - 2 } as const;

export const START_INDEX = /* 与 cellToIndex 保持一致，提前算成常量 */ 1 * COLS + 1;
export const EXIT_INDEX = EXIT.row * COLS + EXIT.col;

/** 四邻方向；顺序固定，方便测试与连走。 */
export const DIRS = ["up", "down", "left", "right"] as const;
export type Dir = (typeof DIRS)[number];

const DELTA: Record<Dir, { dc: number; dr: number }> = {
  up: { dc: 0, dr: -1 },
  down: { dc: 0, dr: 1 },
  left: { dc: -1, dr: 0 },
  right: { dc: 1, dr: 0 },
};

/** 把 [0,1) 之外的随机值夹住，避免注入的 rng 越界。 */
const roll = (rand: () => number): number => {
  const value = rand();
  if (!Number.isFinite(value)) return 0;
  if (value <= 0) return 0;
  if (value >= 0.999999) return 0.999999;
  return value;
};

/** 格子坐标 → 一维下标；越界也照算（调用方自己判断）。 */
export function cellToIndex(col: number, row: number, cols: number = COLS): number {
  return row * cols + col;
}

/** 一维下标 → 格子坐标。 */
export function indexToCell(index: number, cols: number = COLS): { col: number; row: number } {
  const safe = Number.isFinite(index) ? Math.floor(index) : 0;
  return { col: ((safe % cols) + cols) % cols, row: Math.floor(safe / cols) };
}

/** 墙判定：越界一律算墙，省得每个调用点都判边界。 */
export function isWall(
  maze: Uint8Array | readonly number[],
  col: number,
  row: number,
  cols: number = COLS,
  rows: number = ROWS,
): boolean {
  if (col < 0 || row < 0 || col >= cols || row >= rows) return true;
  return maze[cellToIndex(col, row, cols)] !== 0;
}

/**
 * 深度优先回溯生成迷宫：1 = 墙，0 = 走廊。
 *
 * 固定从 (1, 1) 出发，每隔 2 格挖通一堵墙；生成结果是一棵生成树，
 * 因此任意两个走廊格都连通（出口必然可达）。
 */
export function generateMaze(cols: number, rows: number, rand: () => number): Uint8Array {
  const grid = new Uint8Array(cols * rows);
  grid.fill(1);

  const startCol = 1;
  const startRow = 1;
  if (cols < 3 || rows < 3) return grid;

  const start = cellToIndex(startCol, startRow, cols);
  grid[start] = 0;
  const stack: number[] = [start];

  while (stack.length > 0) {
    const current = stack[stack.length - 1];
    if (current === undefined) break;
    const { col, row } = indexToCell(current, cols);

    const options: { dc: number; dr: number }[] = [];
    for (const dir of DIRS) {
      const { dc, dr } = DELTA[dir];
      const nc = col + dc * 2;
      const nr = row + dr * 2;
      if (nc < 1 || nr < 1 || nc > cols - 2 || nr > rows - 2) continue;
      if (grid[cellToIndex(nc, nr, cols)] !== 1) continue;
      options.push({ dc, dr });
    }

    if (options.length === 0) {
      stack.pop();
      continue;
    }

    const pick = options[Math.floor(roll(rand) * options.length)] ?? options[0];
    if (!pick) {
      stack.pop();
      continue;
    }

    // 先挖通中间那堵墙，再挖目标格。
    grid[cellToIndex(col + pick.dc, row + pick.dr, cols)] = 0;
    const next = cellToIndex(col + pick.dc * 2, row + pick.dr * 2, cols);
    grid[next] = 0;
    stack.push(next);
  }

  return grid;
}

/** 走廊之间的一步移动：必须相邻、两端都不是墙；否则返回 -1。 */
export function neighbor(maze: Uint8Array | readonly number[], index: number, dir: Dir): number {
  const { col, row } = indexToCell(index);
  if (isWall(maze, col, row)) return -1;
  const delta = DELTA[dir];
  const nc = col + delta.dc;
  const nr = row + delta.dr;
  if (isWall(maze, nc, nr)) return -1;
  return cellToIndex(nc, nr);
}

/** 只允许相邻（曼哈顿距离 1）且两端都不是墙的移动。 */
export function canWalk(
  maze: Uint8Array | readonly number[],
  from: { col: number; row: number },
  to: { col: number; row: number },
): boolean {
  if (isWall(maze, from.col, from.row) || isWall(maze, to.col, to.row)) return false;
  return Math.abs(from.col - to.col) + Math.abs(from.row - to.row) === 1;
}

/**
 * 迷雾视野：从 from 沿走廊 BFS 扩散，遇到墙停止，切比雪夫距离 ≤ VIEW_RADIUS。
 * 返回走廊格下标（包含 from 自身），按 BFS 顺序。
 */
export function visibleCells(
  maze: Uint8Array | readonly number[],
  from: { col: number; row: number },
): number[] {
  if (isWall(maze, from.col, from.row)) return [];

  const out: number[] = [];
  const seen = new Set<number>();
  const queue: number[] = [cellToIndex(from.col, from.row)];
  seen.add(queue[0] as number);

  const chebyshev = (col: number, row: number): number =>
    Math.max(Math.abs(col - from.col), Math.abs(row - from.row));

  for (let head = 0; head < queue.length; head += 1) {
    const current = queue[head] as number;
    const { col, row } = indexToCell(current);
    out.push(current);
    if (chebyshev(col, row) >= VIEW_RADIUS) continue;

    for (const dir of DIRS) {
      const delta = DELTA[dir];
      const nc = col + delta.dc;
      const nr = row + delta.dr;
      if (isWall(maze, nc, nr)) continue;
      if (chebyshev(nc, nr) > VIEW_RADIUS) continue;
      const next = cellToIndex(nc, nr);
      if (seen.has(next)) continue;
      seen.add(next);
      queue.push(next);
    }
  }

  return out;
}

/** 全部走廊格下标，用于探索度与钥匙摆放。 */
export function walkableIndices(maze: Uint8Array | readonly number[]): number[] {
  const out: number[] = [];
  for (let index = 0; index < maze.length; index += 1) {
    if (maze[index] === 0) out.push(index);
  }
  return out;
}

/**
 * 3 把钥匙随机摆在非起点、非出口的走廊格上。
 * 洗牌式抽样，保证互不重叠；走廊不够时有多少摆多少。
 */
export function placeKeys(
  maze: Uint8Array | readonly number[],
  rand: () => number,
  count: number = KEYS,
): number[] {
  const pool = walkableIndices(maze).filter(
    (index) => index !== START_INDEX && index !== EXIT_INDEX,
  );
  const keys: number[] = [];
  const want = Math.max(0, Math.floor(count));
  for (let i = 0; i < want && i < pool.length; i += 1) {
    const j = i + Math.floor(roll(rand) * (pool.length - i));
    const swap = pool[i] as number;
    pool[i] = pool[j] as number;
    pool[j] = swap;
    keys.push(pool[i] as number);
  }
  return keys;
}

/** `ReadonlySet` 判别：数组没有 `has` / `size`。 */
function isIndexSet(value: unknown): value is ReadonlySet<number> {
  if (!value || typeof value !== "object") return false;
  const candidate = value as ReadonlySet<number>;
  return typeof candidate.has === "function" && typeof candidate.size === "number";
}

/**
 * 已探索百分比：0..100 的整数。
 * `walkable` 既可以是走廊数量，也可以是走廊下标集合（测试两种写法都方便）。
 */
export function exploredPercent(
  explored: ReadonlySet<number>,
  walkable: number | readonly number[] | ReadonlySet<number>,
): number {
  let total = 0;
  let count = 0;

  if (typeof walkable === "number") {
    total = Number.isFinite(walkable) ? Math.max(0, Math.floor(walkable)) : 0;
    count = explored.size;
  } else if (isIndexSet(walkable)) {
    total = walkable.size;
    for (const index of explored) {
      if (walkable.has(index)) count += 1;
    }
  } else {
    const list = walkable as readonly number[];
    total = list.length;
    for (const index of explored) {
      if (list.includes(index)) count += 1;
    }
  }

  if (total <= 0) return 0;
  const percent = Math.round((Math.min(count, total) / total) * 100);
  return percent < 0 ? 0 : percent > 100 ? 100 : percent;
}

/** 起点到目标是否 BFS 可达（单测与「出口激活」判定共用）。 */
export function reachable(
  maze: Uint8Array | readonly number[],
  from: number,
  to: number,
): boolean {
  if (from < 0 || to < 0 || from >= maze.length || to >= maze.length) return false;
  if (maze[from] !== 0 || maze[to] !== 0) return false;

  const seen = new Uint8Array(maze.length);
  const queue: number[] = [from];
  seen[from] = 1;
  for (let head = 0; head < queue.length; head += 1) {
    const current = queue[head] as number;
    if (current === to) return true;
    const { col, row } = indexToCell(current);
    for (const dir of DIRS) {
      const delta = DELTA[dir];
      const nc = col + delta.dc;
      const nr = row + delta.dr;
      if (isWall(maze, nc, nr)) continue;
      const next = cellToIndex(nc, nr);
      if (seen[next]) continue;
      seen[next] = 1;
      queue.push(next);
    }
  }
  return false;
}

/** 格心坐标（逻辑像素），渲染与粒子共用。 */
export function cellCenter(index: number): { x: number; y: number } {
  const { col, row } = indexToCell(index);
  return {
    x: ORIGIN.x + col * CELL + Math.floor(CELL / 2),
    y: ORIGIN.y + row * CELL + Math.floor(CELL / 2),
  };
}

/** 动作名 → 方向；不认识的返回 null。 */
export function dirFromAction(action: string): Dir | null {
  return (DIRS as readonly string[]).includes(action) ? (action as Dir) : null;
}
