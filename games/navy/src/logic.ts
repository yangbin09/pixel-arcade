/**
 * 海战棋（navy）纯规则层：8×8 棋盘、五艘舰队、炮击判定、AI 概率网格。
 *
 * 不碰 DOM / Canvas，也不调用 `Math.random()` —— 所有随机源都由调用方注入，
 * 所以「同种子同布阵」「AI 局面可复现」都能直接单测。
 *
 * 棋盘是一维数组，`index = y * SIZE + x`；格子状态只用 UNKNOWN / MISS / HIT。
 */

export const SIZE = 8;
export const CELLS = SIZE * SIZE;

/** 舰队（长度）：5 / 4 / 3 / 3 / 2，合计 17 格。 */
export const FLEET: readonly number[] = [5, 4, 3, 3, 2];

/** 双方各 17 格舰体，全部打光即告负。 */
export const TOTAL_SHIP_CELLS = FLEET.reduce((sum, length) => sum + length, 0);

/** 计分：命中 +1、击沉 +10、全歼 +100。满分为 17 + 5*10 + 100 = 167。 */
export const HIT_POINTS = 1;
export const SINK_BONUS = 10;
export const WIPE_BONUS = 100;
export const MAX_SCORE = TOTAL_SHIP_CELLS * HIT_POINTS + FLEET.length * SINK_BONUS + WIPE_BONUS;

/** 格子状态：0 未打、1 打空、2 命中。 */
export const UNKNOWN = 0;
export const MISS = 1;
export const HIT = 2;

/** AI 每回合退回纯随机的概率（规格要求 30%，避免 AI 过强）。 */
export const AI_RANDOM_CHANCE = 0.3;

export interface Ship {
  /** 舰体占用的格子（升序，长度 = 舰长）。 */
  cells: number[];
  /** 已被命中的格子。 */
  hits: Set<number>;
}

export interface ShotResult {
  /** 是否命中舰体。 */
  hit: boolean;
  /** 本次命中把整艘舰打沉时，返回该舰长度；否则 null。 */
  sunk: number | null;
  /** 这一格之前已经打过（调用方应忽略这次炮击）。 */
  already: boolean;
}

/** 空棋盘：64 格全部未打。 */
export function emptyBoard(): number[] {
  return new Array<number>(CELLS).fill(UNKNOWN);
}

export function cellToIndex(x: number, y: number): number {
  return y * SIZE + x;
}

export function indexToCell(index: number): { x: number; y: number } {
  return { x: index % SIZE, y: Math.floor(index / SIZE) };
}

export function inBounds(x: number, y: number): boolean {
  return x >= 0 && x < SIZE && y >= 0 && y < SIZE;
}

/** 四邻（上下左右），出界的不返回。追残舰和邻居权重都用它。 */
export function neighborsOf(index: number): number[] {
  const { x, y } = indexToCell(index);
  const out: number[] = [];
  if (y > 0) out.push(cellToIndex(x, y - 1));
  if (y < SIZE - 1) out.push(cellToIndex(x, y + 1));
  if (x > 0) out.push(cellToIndex(x - 1, y));
  if (x < SIZE - 1) out.push(cellToIndex(x + 1, y));
  return out;
}

/** 某格上的舰（不在任何舰上返回 null）。 */
export function shipAt(ships: readonly Ship[], index: number): Ship | null {
  for (const ship of ships) {
    if (ship.cells.includes(index)) return ship;
  }
  return null;
}

/** 全部格都被命中才算沉。 */
export function isSunk(ship: Ship): boolean {
  return ship.cells.every((cell) => ship.hits.has(cell));
}

export function allSunk(ships: readonly Ship[]): boolean {
  return ships.every((ship) => isSunk(ship));
}

/** 已沉舰数量（画战果、算 HUD 都用它）。 */
export function sunkCount(ships: readonly Ship[]): number {
  return ships.reduce((count, ship) => (isSunk(ship) ? count + 1 : count), 0);
}

/** 盘面已命中格数（= 玩家得分里的「命中」）。 */
export function hitCount(board: readonly number[]): number {
  let count = 0;
  for (const state of board) if (state === HIT) count += 1;
  return count;
}

/* ------------------------------------------------------------------ */
/* 布阵                                                                */
/* ------------------------------------------------------------------ */

/**
 * 某舰长的全部摆放位置（横竖两个方向）。
 *
 * 长度固定，只算一次并缓存；这是模块级常量数据，不依赖任何外部状态。
 */
const LAYOUT_CACHE = new Map<number, number[][]>();

function layoutsOf(length: number): number[][] {
  const cached = LAYOUT_CACHE.get(length);
  if (cached) return cached;

  const out: number[][] = [];
  for (let y = 0; y < SIZE; y += 1) {
    for (let x = 0; x < SIZE; x += 1) {
      if (x + length <= SIZE) {
        const cells: number[] = [];
        for (let i = 0; i < length; i += 1) cells.push(cellToIndex(x + i, y));
        out.push(cells);
      }
      if (y + length <= SIZE) {
        const cells: number[] = [];
        for (let i = 0; i < length; i += 1) cells.push(cellToIndex(x, y + i));
        out.push(cells);
      }
    }
  }
  LAYOUT_CACHE.set(length, out);
  return out;
}

/** 兜底布阵：极端随机源下也一定给出合法舰队，保证函数必定终止且合法。 */
const FALLBACK_LAYOUT: readonly (readonly number[])[] = [
  [0, 1, 2, 3, 4], // 5：第 0 行
  [24, 25, 26, 27], // 4：第 3 行
  [48, 49, 50], // 3：第 6 行
  [7, 15, 23], // 3：第 7 列（0–2 行）
  [37, 38], // 2：第 4 行第 5–6 列
];

const toShips = (layout: readonly (readonly number[])[]): Ship[] =>
  layout.map((cells) => ({ cells: cells.slice(), hits: new Set<number>() }));

/** 把 rand 的返回值夹进 [0, 1)，极端值（1 / NaN）也不会取到越界下标。 */
function unit(rand: () => number): number {
  const raw = rand();
  if (!Number.isFinite(raw) || raw <= 0) return 0;
  if (raw >= 1) return 0.999999999;
  return raw;
}

/** 单次尝试：从大到小逐艘贴，失败（放不下）返回 null。 */
function tryPlace(rand: () => number): Ship[] | null {
  // blocked：已被占用的格子，以及它们的四邻（不允许贴边相邻）。
  const blocked = new Array<boolean>(CELLS).fill(false);
  const ships: Ship[] = [];

  for (const length of FLEET) {
    const fits = layoutsOf(length).filter((layout) => layout.every((cell) => !blocked[cell]));
    if (fits.length === 0) return null;

    const layout = fits[Math.floor(unit(rand) * fits.length)] as number[];
    for (const cell of layout) {
      blocked[cell] = true;
      for (const neighbor of neighborsOf(cell)) blocked[neighbor] = true;
    }
    ships.push({ cells: layout.slice(), hits: new Set<number>() });
  }

  return ships;
}

/** 整盘重试上限：8×8 上贴 17 格舰体又要留 1 格间隔，偶尔会走到死角。 */
const FLEET_ATTEMPTS = 400;

/**
 * 随机布阵：五艘舰不重叠、不贴边相邻（对角相邻允许）。
 *
 * 同一个 rand 序列必然得到同一套布阵；失败到上限时退回固定兜底布阵，
 * 所以永远返回合法的舰队。
 */
export function placeFleet(rand: () => number): Ship[] {
  for (let attempt = 0; attempt < FLEET_ATTEMPTS; attempt += 1) {
    const fleet = tryPlace(rand);
    if (fleet) return fleet;
  }
  return toShips(FALLBACK_LAYOUT);
}

/** 舰队是否满足规则（测试和兜底校验共用）。 */
export function isValidFleet(ships: readonly Ship[]): boolean {
  if (ships.length !== FLEET.length) return false;

  /** 格子 → 所属舰的下标；发现重叠就返回 null。 */
  const owner = new Map<number, number>();
  for (let i = 0; i < ships.length; i += 1) {
    const ship = ships[i] as Ship;
    if (ship.cells.length !== FLEET[i]) return false;

    for (const cell of ship.cells) {
      if (!Number.isInteger(cell) || cell < 0 || cell >= CELLS) return false;
      if (owner.has(cell)) return false; // 重叠
      owner.set(cell, i);
    }
  }

  if (owner.size !== TOTAL_SHIP_CELLS) return false;

  // 贴边相邻：只有在**不同舰**之间才禁止；同一艘舰的相邻格正是舰体本身。
  for (const [cell, shipIndex] of owner) {
    for (const neighbor of neighborsOf(cell)) {
      const neighborOwner = owner.get(neighbor);
      if (neighborOwner !== undefined && neighborOwner !== shipIndex) return false;
    }
  }

  return true;
}

/* ------------------------------------------------------------------ */
/* 炮击                                                                */
/* ------------------------------------------------------------------ */

/**
 * 在 `board` 上打 `index` 这一格，命中则记进对应舰的 `hits`。
 *
 * 直接修改 board 与 ships（调用方持有本局状态，避免每帧拷贝）；
 * 已经打过的格子返回 `already: true` 且不改任何状态。
 */
export function resolveShot(board: number[], ships: Ship[], index: number): ShotResult {
  if (!Number.isInteger(index) || index < 0 || index >= CELLS) {
    return { hit: false, sunk: null, already: true };
  }
  if (board[index] !== UNKNOWN) {
    return { hit: false, sunk: null, already: true };
  }

  const ship = shipAt(ships, index);
  if (!ship) {
    board[index] = MISS;
    return { hit: false, sunk: null, already: false };
  }

  board[index] = HIT;
  ship.hits.add(index);
  return { hit: true, sunk: isSunk(ship) ? ship.cells.length : null, already: false };
}

/* ------------------------------------------------------------------ */
/* AI                                                                  */
/* ------------------------------------------------------------------ */

/**
 * 概率网格：64 个权重。
 *
 * 对每一艘未沉舰的所有可能摆放位置做计数，某个格子被越多摆放覆盖就越可疑。
 * 已经打空的格子（MISS）权重为 0；命中格仍计入（追残舰时权重最高）。
 */
export function probabilityGrid(board: readonly number[], ships: readonly Ship[]): number[] {
  const weights = new Array<number>(CELLS).fill(0);

  for (const ship of ships) {
    if (isSunk(ship)) continue;
    for (const layout of layoutsOf(ship.cells.length)) {
      let fits = true;
      for (const cell of layout) {
        if (board[cell] === MISS) {
          fits = false;
          break;
        }
      }
      if (!fits) continue;
      for (const cell of layout) weights[cell] += 1;
    }
  }

  return weights;
}

/** 还没打过的格子（升序，保证可复现）。 */
export function unknownCells(board: readonly number[]): number[] {
  const out: number[] = [];
  for (let index = 0; index < CELLS; index += 1) {
    if (board[index] === UNKNOWN) out.push(index);
  }
  return out;
}

/** 纯随机一炮；没有空格了返回 -1。 */
export function pickRandomShot(board: readonly number[], rand: () => number): number {
  const candidates = unknownCells(board);
  if (candidates.length === 0) return -1;
  return candidates[Math.floor(unit(rand) * candidates.length)] as number;
}

/**
 * 命中之后把该点的四邻塞进优先队列（追残舰）。
 *
 * 已经打过的格子、队列里已有的格子都不重复加入。
 */
export function noteHit(hitStack: number[], board: readonly number[], index: number): void {
  for (const neighbor of neighborsOf(index)) {
    if (board[neighbor] !== UNKNOWN) continue;
    if (hitStack.includes(neighbor)) continue;
    hitStack.push(neighbor);
  }
}

/**
 * AI 选点，返回要打的格子；棋盘已满返回 -1。
 *
 * 优先级：
 * 1. `hitStack` 里的候选（上一个命中点的四邻）—— 追残舰；
 * 2. 30% 概率直接随机（给人类留出翻盘空间）；
 * 3. 概率网格权重最高的格子，平手用 rand 挑一个。
 *
 * 会消耗 `hitStack` 里已经被打过的条目（LIFO 弹出），做好这类副作用是为了
 * 让调用方不必自己维护队列。
 */
export function pickShot(
  board: readonly number[],
  ships: readonly Ship[],
  hitStack: number[],
  rand: () => number,
): number {
  while (hitStack.length > 0) {
    const index = hitStack.pop() as number;
    if (board[index] === UNKNOWN) return index;
  }

  const candidates = unknownCells(board);
  if (candidates.length === 0) return -1;

  // 规格：允许 AI 有 30% 概率退回纯随机，避免过强。
  if (unit(rand) < AI_RANDOM_CHANCE) {
    return candidates[Math.floor(unit(rand) * candidates.length)] as number;
  }

  const weights = probabilityGrid(board, ships);
  let best = -1;
  let bestWeight = 0;
  for (const cell of candidates) {
    const weight = weights[cell] as number;
    if (weight > bestWeight) {
      bestWeight = weight;
      best = cell;
    }
  }
  // 网格全 0（理论上不会发生）时退回随机，保证一定给出可打的格子。
  if (best < 0) return candidates[Math.floor(unit(rand) * candidates.length)] as number;

  const pool: number[] = [];
  for (const cell of candidates) {
    if (weights[cell] === bestWeight) pool.push(cell);
  }
  return pool[Math.floor(unit(rand) * pool.length)] as number;
}

/* ------------------------------------------------------------------ */
/* 键盘光标                                                            */
/* ------------------------------------------------------------------ */

/**
 * 键盘光标移动：沿方向走，跳过已经打过的格子；走到边界还没找到就原地不动。
 * 非方向动作原样返回。
 */
export function stepCursor(index: number, action: string, board?: readonly number[]): number {
  const safe = Number.isInteger(index) && index >= 0 && index < CELLS ? index : 0;
  const { x, y } = indexToCell(safe);

  let dx = 0;
  let dy = 0;
  switch (action) {
    case "left":
      dx = -1;
      break;
    case "right":
      dx = 1;
      break;
    case "up":
      dy = -1;
      break;
    case "down":
      dy = 1;
      break;
    default:
      return safe;
  }

  let nx = x + dx;
  let ny = y + dy;
  while (inBounds(nx, ny)) {
    const next = cellToIndex(nx, ny);
    if (!board || board[next] === UNKNOWN) return next;
    nx += dx;
    ny += dy;
  }
  return safe;
}
