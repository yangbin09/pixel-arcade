/**
 * 接水管纯规则层：管道旋转、注水扩散、漏水判定、关卡生成。
 *
 * 不碰 DOM / Canvas，也不调用 `Math.random()`：随机源由调用方注入，
 * 所以「同种子同关卡」「生成结果必可解」「初始摆盘不漏水」都能直接单测。
 *
 * 管道用 4 位掩码表示四个方向的接头（上/右/下/左 = 1/2/4/8），
 * 顺时针旋转一次 = 所有位整体左移一格（最高位绕回最低位）。
 */

export const COLS = 7;
export const ROWS = 9;
/** 7×9 = 63 格。 */
export const CELLS = COLS * ROWS;
/** 每格 20 逻辑像素，棋盘实际 140×180。 */
export const CELL = 20;
/** 棋盘左上角原点；水平居中（168-140)/2 = 14。 */
export const ORIGIN = { x: 14, y: 24 } as const;
/** 步数上限：超过即判负（规格里的 80）。 */
export const MAX_MOVES = 80;

export const UP = 0b0001;
export const RIGHT = 0b0010;
export const DOWN = 0b0100;
export const LEFT = 0b1000;

/** 水源在左上格，出口在右下格。 */
export const START_INDEX = 0;
export const END_INDEX = CELLS - 1;

/** 四个方向的顺序固定为 上/右/下/左，和掩码位数一一对应。 */
const DIR_BITS = [UP, RIGHT, DOWN, LEFT] as const;
const DIR_DELTA = [
  { dc: 0, dr: -1 },
  { dc: 1, dr: 0 },
  { dc: 0, dr: 1 },
  { dc: -1, dr: 0 },
] as const;

/** 顺时针旋转一次：上→右→下→左→上。 */
export function rotate(mask: number): number {
  const value = mask & 0b1111;
  return ((value << 1) | (value >> 3)) & 0b1111;
}

/** 顺时针旋转 times 次（负数按 4 取模）。 */
export function applyRotate(mask: number, times: number): number {
  const turns = ((Math.round(times) % 4) + 4) % 4;
  let out = mask & 0b1111;
  for (let i = 0; i < turns; i += 1) out = rotate(out);
  return out;
}

/** 反向位：上↔下、左↔右（顺时针转两次）。 */
export function opposite(dir: number): number {
  return rotate(rotate(dir));
}

/** A 的右边与 B 的左边是否都连通（规格要求的横向判定）。 */
export function connects(maskA: number, maskB: number): boolean {
  return (maskA & RIGHT) !== 0 && (maskB & LEFT) !== 0;
}

/** 某格朝某个方向的接头是否接上了相邻格的对向接头。 */
function linked(grid: readonly number[], from: number, to: number, dir: number): boolean {
  return ((grid[from] ?? 0) & dir) !== 0 && ((grid[to] ?? 0) & opposite(dir)) !== 0;
}

/** 注入的随机源可能越界（测试里常用 () => 1），先夹到 [0,1)。 */
const roll = (rand: () => number): number => {
  const value = rand();
  if (!Number.isFinite(value) || value <= 0) return 0;
  if (value >= 1) return 0.999999;
  return value;
};

const rowsOfGrid = (grid: readonly number[]): number => Math.max(1, Math.round(grid.length / COLS));

/** 从起点注水，只沿「两侧都连通」的相邻格扩散；返回能通水的格子索引。 */
function flowWithin(start: number, grid: readonly number[], cols: number, rows: number): number[] {
  const total = cols * rows;
  if (start < 0 || start >= total) return [];
  // 水从左边缘进入：起点没有左接头就注不进水。
  if (((grid[start] ?? 0) & LEFT) === 0) return [];

  const seen = new Uint8Array(total);
  const out: number[] = [];
  const queue: number[] = [start];
  seen[start] = 1;

  while (queue.length > 0) {
    const index = queue.shift() as number;
    out.push(index);
    const col = index % cols;
    const row = (index - col) / cols;
    for (let d = 0; d < 4; d += 1) {
      const delta = DIR_DELTA[d]!;
      const nextCol = col + delta.dc;
      const nextRow = row + delta.dr;
      if (nextCol < 0 || nextCol >= cols || nextRow < 0 || nextRow >= rows) continue;
      const next = nextRow * cols + nextCol;
      if (seen[next]) continue;
      if (!linked(grid, index, next, DIR_BITS[d]!)) continue;
      seen[next] = 1;
      queue.push(next);
    }
  }

  return out;
}

export function flowFrom(start: number, grid: readonly number[]): number[] {
  return flowWithin(start, grid, COLS, rowsOfGrid(grid));
}

/**
 * 漏水格子：已注水的格子里，接头指向棋盘外侧的（水流出去就是漏）。
 * 起点左边缘（水源）与终点右边缘（出口）是两个合法开口，不算漏。
 */
function leakWithin(
  grid: readonly number[],
  filled: readonly number[],
  cols: number,
  rows: number,
): number[] {
  const total = cols * rows;
  const out: number[] = [];
  for (const index of filled) {
    if (index < 0 || index >= total) continue;
    const mask = grid[index] ?? 0;
    const col = index % cols;
    const row = (index - col) / cols;
    for (let d = 0; d < 4; d += 1) {
      const dir = DIR_BITS[d]!;
      if ((mask & dir) === 0) continue;
      const delta = DIR_DELTA[d]!;
      const nextCol = col + delta.dc;
      const nextRow = row + delta.dr;
      if (nextCol >= 0 && nextCol < cols && nextRow >= 0 && nextRow < rows) continue;
      if (index === 0 && dir === LEFT) continue;
      if (index === total - 1 && dir === RIGHT) continue;
      if (!out.includes(index)) out.push(index);
    }
  }
  return out;
}

/** 漏水格子列表（渲染要标红）。 */
export function leakCells(grid: readonly number[], filled: readonly number[]): number[] {
  return leakWithin(grid, filled, COLS, rowsOfGrid(grid));
}

/** 漏水数；> 0 立即判负。 */
export function countLeaks(grid: readonly number[], filled: readonly number[]): number {
  return leakCells(grid, filled).length;
}

/** 注水进度百分比（0–100 的整数，直接喂 HUD）。 */
export function filledPercent(filled: readonly number[], total: number = CELLS): number {
  if (total <= 0) return 0;
  const ratio = filled.length / total;
  return Math.max(0, Math.min(100, Math.round(ratio * 100)));
}

function solvableWithin(
  grid: readonly number[],
  solution: readonly number[],
  cols: number,
  rows: number,
): boolean {
  const total = cols * rows;
  if (grid.length !== total || solution.length !== total) return false;
  const rotated: number[] = new Array(total);
  for (let index = 0; index < total; index += 1) {
    rotated[index] = applyRotate(grid[index] ?? 0, solution[index] ?? 0);
  }
  const filled = flowWithin(0, rotated, cols, rows);
  if (filled.length !== total) return false;
  return leakWithin(rotated, filled, cols, rows).length === 0;
}

/**
 * 白盒校验：按 solution 把每格顺时针转几次之后，能不能把 63 格全部注满且不漏水。
 * 关卡生成自带这道校验（不满足就重来），单测也直接拿它钉死「生成必可解」。
 */
export function isSolvable(grid: readonly number[], solution: readonly number[]): boolean {
  return solvableWithin(grid, solution, COLS, rowsOfGrid(grid));
}

/* ---------------- 关卡生成 ---------------- */

/** 某格的四邻居索引（顺序固定：上右下左）。 */
function neighborsOf(index: number, cols: number, rows: number): number[] {
  const col = index % cols;
  const row = (index - col) / cols;
  const out: number[] = [];
  for (let d = 0; d < 4; d += 1) {
    const delta = DIR_DELTA[d]!;
    const nextCol = col + delta.dc;
    const nextRow = row + delta.dr;
    if (nextCol < 0 || nextCol >= cols || nextRow < 0 || nextRow >= rows) continue;
    out.push(nextRow * cols + nextCol);
  }
  return out;
}

/** 从 A 走一步到相邻的 B，方向位是哪一位。 */
function directionBetween(cols: number, from: number, to: number): number {
  if (to === from - cols) return UP;
  if (to === from + 1) return RIGHT;
  if (to === from + cols) return DOWN;
  return LEFT;
}

/**
 * 一笔画通路：左上角 → 每一格恰好经过一次 → 右下角。
 *
 * 只有「通路盖满全盘」时，「全部格子注满 → 通关」才是可达的目标；
 * 规格允许的死路（连通不到的散格）会让 100% 注水变成永远不可能，
 * 所以这里有意只生成盖满全盘的一笔画通路（等价于零死路的特例）。
 *
 * Warnsdorff 式排序（先走自由度小的格，同分用注入的随机源打散）+ 剪枝。
 * 预算用尽返回 null，由调用方重来。
 */
function buildPath(cols: number, rows: number, rand: () => number): number[] | null {
  const total = cols * rows;
  if (total < 2) return total === 1 ? [0] : null;
  const end = total - 1;

  const seen = new Uint8Array(total);
  const path: number[] = [0];
  seen[0] = 1;
  let budget = 4000;

  const openness = (index: number): number => {
    let count = 0;
    for (const next of neighborsOf(index, cols, rows)) {
      if (!seen[next]) count += 1;
    }
    return count;
  };

  const walk = (): boolean => {
    budget -= 1;
    if (budget < 0) return false;
    const depth = path.length;
    if (depth === total) return path[depth - 1] === end;
    const last = path[depth - 1] as number;
    // 已经踩到终点却没走满：终点只能是最后一格。
    if (last === end) return false;
    // 剪枝：任何还有入口为 0 的未访问格（终点除外）都不可能再连上。
    for (let index = 0; index < total; index += 1) {
      if (seen[index] || index === end) continue;
      if (openness(index) === 0) return false;
    }

    const options = neighborsOf(last, cols, rows)
      .filter((next) => !seen[next])
      .map((next) => ({ next, rank: openness(next) + roll(rand) * 0.5 }))
      .sort((a, b) => a.rank - b.rank);

    for (const option of options) {
      seen[option.next] = 1;
      path.push(option.next);
      if (walk()) return true;
      path.pop();
      seen[option.next] = 0;
      if (budget < 0) return false;
    }
    return false;
  };

  return walk() ? path.slice() : null;
}

/** 兜底蛇形通路：逐行往返，行数为奇数时正好收在右下角。 */
function rowSnake(cols: number, rows: number): number[] {
  const path: number[] = [];
  for (let row = 0; row < rows; row += 1) {
    for (let step = 0; step < cols; step += 1) {
      const col = row % 2 === 0 ? step : cols - 1 - step;
      path.push(row * cols + col);
    }
  }
  return path;
}

/** 兜底蛇形通路：逐列往返。 */
function colSnake(cols: number, rows: number): number[] {
  const path: number[] = [];
  for (let col = 0; col < cols; col += 1) {
    for (let step = 0; step < rows; step += 1) {
      const row = col % 2 === 0 ? step : rows - 1 - step;
      path.push(row * cols + col);
    }
  }
  return path;
}

/** 找出收在右下角的兜底通路。 */
function fallbackPath(cols: number, rows: number): number[] {
  const total = cols * rows;
  for (const candidate of [rowSnake(cols, rows), colSnake(cols, rows)]) {
    if (candidate[0] === 0 && candidate[candidate.length - 1] === total - 1) return candidate;
  }
  return rowSnake(cols, rows);
}

/** 路径 → 每格的「正确朝向」掩码：朝前一格 + 朝后一格（起点加左、终点加右）。 */
function masksFromPath(path: readonly number[], cols: number): number[] {
  const total = path.length;
  const grid: number[] = new Array(total).fill(0);
  for (let i = 0; i < path.length; i += 1) {
    const index = path[i] as number;
    let mask = 0;
    if (i > 0) mask |= directionBetween(cols, index, path[i - 1] as number);
    if (i + 1 < path.length) mask |= directionBetween(cols, index, path[i + 1] as number);
    if (i === 0) mask |= LEFT; // 水源从左边缘进来
    if (i === path.length - 1) mask |= RIGHT; // 出口在右边缘
    grid[index] = mask;
  }
  return grid;
}

/**
 * 生成一关：一笔画通路 → 每格正确朝向 → 把**内圈格子**随机转乱。
 *
 * 为什么只转内圈（见下面的「中间态不漏水」）：
 * 漏水判定的对象是「水已经流到的格子」。玩家的解是一条转格顺序，
 * 中间态的管道朝向是乱的，如果边缘格子被转成了朝棋盘外的开口，
 * 水一旦推进到那格就会漏 —— 实测逐格转和贪心转的 60 关里只有 3 / 13 关
 * 存在一条不漏水的转法，等于关卡几乎不可能通关。
 * 边缘格子的正确朝向本来就不含朝外的开口（除起点左口、终点右口），
 * 只要边缘格子永远保持正确朝向、把要转的格子限制在内圈，
 * 那么内圈格子的任何朝向都不可能指向棋盘外 → **任何中间态都不会漏水**。
 *
 * 返回的 solution 是白盒解（每格还要顺时针转几次）。
 */
export function generateLevel(
  cols: number,
  rows: number,
  rand: () => number,
): { grid: number[]; solution: number[] } {
  const total = cols * rows;

  for (let attempt = 0; attempt < 30; attempt += 1) {
    const path = buildPath(cols, rows, rand);
    if (!path) continue;
    const target = masksFromPath(path, cols);

    const grid: number[] = new Array(total);
    const solution: number[] = new Array(total);
    let planned = 0;

    for (let index = 0; index < total; index += 1) {
      const col = index % cols;
      const row = (index - col) / cols;
      const edge = row === 0 || row === rows - 1 || col === 0 || col === cols - 1;
      // 边缘一律保持正确朝向；内圈转 0–3 次
      const turns = edge ? 0 : Math.floor(roll(rand) * 4) % 4;
      solution[index] = turns;
      planned += turns;
      // 打乱：先逆着转回去，玩家顺时针转 turns 次即可复位。
      grid[index] = applyRotate(target[index] ?? 0, (4 - turns) % 4);
    }

    // 太简单（几乎不用转）或者理论步数已经超过上限的关卡都不要。
    if (planned < 8) continue;
    if (planned > MAX_MOVES - 4) continue;
    if (!solvableWithin(grid, solution, cols, rows)) continue;

    // 保险：初始局面本身既不能已经漏水，也不能一开局就通关。
    const wet = flowWithin(0, grid, cols, rows);
    if (leakWithin(grid, wet, cols, rows).length > 0) continue;
    if (wet.length === total) continue;

    return { grid, solution };
  }

  // 兜底：固定蛇形布局，只把内圈统一多转一格（解 = 每格 1 步），永远可解且不漏水。
  const target = masksFromPath(fallbackPath(cols, rows), cols);
  const grid: number[] = new Array(total);
  const solution: number[] = new Array(total);
  for (let index = 0; index < total; index += 1) {
    const col = index % cols;
    const row = (index - col) / cols;
    const edge = row === 0 || row === rows - 1 || col === 0 || col === cols - 1;
    solution[index] = edge ? 0 : 1;
    grid[index] = applyRotate(target[index] ?? 0, edge ? 0 : 3);
  }
  return { grid, solution };
}
