/**
 * 扫雷纯规则层：布雷、邻雷数、洪水填充、插旗、胜利判定。
 *
 * 不碰 DOM / Canvas，随机源由调用方注入，
 * 所以「首点安全」「洪水填充」「胜利判定」都能直接单测。
 */

export const SIZE = 8;
export const CELLS = SIZE * SIZE;
export const MINES = 10;

export interface Board {
  mines: boolean[];
  counts: number[];
  opened: boolean[];
  flagged: boolean[];
  /** 是否已经布雷（首次翻开前为 false）。 */
  placed: boolean;
  /** 本局总雷数；布雷前也算 10，方便 HUD 直接显示。 */
  mineCount: number;
  openedCount: number;
  flags: number;
}

export interface RevealResult {
  hitMine: boolean;
  /** 本次新翻开的格子，按 BFS 顺序；踩雷时为空。 */
  opened: number[];
}

export type FlagResult = "on" | "off" | "blocked";

/** 8 邻域预计算表：下标是格子序号，值是相邻格子序号。 */
const NEIGHBORS: readonly number[][] = buildNeighbors();

function buildNeighbors(): number[][] {
  const table: number[][] = [];
  for (let index = 0; index < CELLS; index += 1) {
    const row = Math.floor(index / SIZE);
    const col = index % SIZE;
    const list: number[] = [];
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        if (dx === 0 && dy === 0) continue;
        const r = row + dy;
        const c = col + dx;
        if (r < 0 || c < 0 || r >= SIZE || c >= SIZE) continue;
        list.push(r * SIZE + c);
      }
    }
    table.push(list);
  }
  return table;
}

export function neighborsOf(index: number): readonly number[] {
  return NEIGHBORS[index] ?? [];
}

/** 空棋盘：未布雷、全未翻开。 */
export function createBoard(): Board {
  return {
    mines: new Array<boolean>(CELLS).fill(false),
    counts: new Array<number>(CELLS).fill(0),
    opened: new Array<boolean>(CELLS).fill(false),
    flagged: new Array<boolean>(CELLS).fill(false),
    placed: false,
    mineCount: MINES,
    openedCount: 0,
    flags: 0,
  };
}

/** 重新统计每格 8 邻域的雷数；只在布雷后调用。 */
function countNeighbors(board: Board): void {
  for (let index = 0; index < CELLS; index += 1) {
    if (board.mines[index]) {
      board.counts[index] = 0;
      continue;
    }
    let count = 0;
    for (const neighbor of NEIGHBORS[index]) {
      if (board.mines[neighbor]) count += 1;
    }
    board.counts[index] = count;
  }
}

/**
 * 首次翻开后布雷：排除 safeIndex 及其 8 邻域，再统计邻雷数。
 * 洗牌式抽样，保证每颗雷落在不同格子里。
 */
export function placeMines(board: Board, safeIndex: number, rng: () => number = Math.random): void {
  const banned = new Set<number>([safeIndex, ...neighborsOf(safeIndex)]);
  const pool: number[] = [];
  for (let index = 0; index < CELLS; index += 1) {
    if (!banned.has(index)) pool.push(index);
  }

  board.mines.fill(false);
  for (let i = 0; i < MINES && i < pool.length; i += 1) {
    const j = i + Math.floor(rng() * (pool.length - i));
    const swap = pool[i];
    pool[i] = pool[j];
    pool[j] = swap;
    board.mines[pool[i]] = true;
  }

  board.mineCount = MINES;
  board.placed = true;
  countNeighbors(board);
}

/**
 * 按给定位置布雷（测试与摆盘用）。
 * 与 placeMines 一样会重算邻雷数，但不去重随机。
 */
export function placeMinesAt(board: Board, mines: readonly number[]): void {
  board.mines.fill(false);
  board.mineCount = 0;
  for (const index of mines) {
    if (index < 0 || index >= CELLS || board.mines[index]) continue;
    board.mines[index] = true;
    board.mineCount += 1;
  }
  board.placed = true;
  countNeighbors(board);
}

/** 翻开一格：数字格只开一格，0 邻域用 BFS 向外扩散。 */
export function reveal(board: Board, index: number): RevealResult {
  if (index < 0 || index >= CELLS) return { hitMine: false, opened: [] };
  if (!board.placed || board.opened[index] || board.flagged[index]) {
    return { hitMine: false, opened: [] };
  }
  if (board.mines[index]) return { hitMine: true, opened: [] };

  const opened: number[] = [];

  if (board.counts[index] > 0) {
    board.opened[index] = true;
    board.openedCount += 1;
    opened.push(index);
    return { hitMine: false, opened };
  }

  // 洪水填充：只把非雷、未开、未插旗的格子入队，避免重复计数。
  const queue: number[] = [index];
  let head = 0;
  while (head < queue.length) {
    const current = queue[head];
    head += 1;
    if (board.opened[current] || board.flagged[current] || board.mines[current]) continue;

    board.opened[current] = true;
    board.openedCount += 1;
    opened.push(current);

    if (board.counts[current] !== 0) continue;
    for (const neighbor of NEIGHBORS[current]) {
      if (board.opened[neighbor] || board.flagged[neighbor] || board.mines[neighbor]) continue;
      queue.push(neighbor);
    }
  }

  return { hitMine: false, opened };
}

/** 插旗 / 取消旗；旗子总数不能超过本局雷数。 */
export function toggleFlag(board: Board, index: number): FlagResult {
  if (index < 0 || index >= CELLS) return "blocked";
  if (board.opened[index]) return "blocked";

  if (board.flagged[index]) {
    board.flagged[index] = false;
    board.flags -= 1;
    return "off";
  }

  if (board.flags >= board.mineCount) return "blocked";
  board.flagged[index] = true;
  board.flags += 1;
  return "on";
}

/** 已开格数用于胜利判定，不需要每次遍历棋盘。 */
export function isWin(board: Board): boolean {
  return board.placed && board.openedCount >= CELLS - board.mineCount;
}
