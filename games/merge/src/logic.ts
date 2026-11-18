/**
 * 2048 纯规则层。
 *
 * 只处理 4×4 数字矩阵，不碰 DOM / Canvas；生成新块的随机源由调用方注入，
 * 因此滑动、合并、结算判定都可以直接单测。
 */

export const SIZE = 4;

export type Direction = "up" | "down" | "left" | "right";

/** 0 表示空格，其余为 2 的幂。 */
export type Grid = number[][];

/** 一次滑动里某一块从哪走到哪（动画用，包含没有移动的块）。 */
export interface Slide {
  fromRow: number;
  fromCol: number;
  toRow: number;
  toCol: number;
  /** 移动前的数值（合并块也是各自的原值）。 */
  value: number;
}

/** 合并发生的位置与合并后的数值。 */
export interface Merge {
  row: number;
  col: number;
  value: number;
}

export interface MoveResult {
  /** 棋盘是否真的发生了变化。 */
  moved: boolean;
  /** 移动后的新棋盘，原棋盘不会被修改。 */
  grid: Grid;
  /** 本次滑动获得的分数（所有合并值之和）。 */
  gained: number;
  slides: Slide[];
  merges: Merge[];
}

export interface Spawn {
  row: number;
  col: number;
  value: number;
}

export interface SpawnResult {
  grid: Grid;
  /** 棋盘已满时返回 null（正常流程不会走到这里）。 */
  spawn: Spawn | null;
}

/** 空棋盘。 */
export function emptyGrid(): Grid {
  return Array.from({ length: SIZE }, () => new Array<number>(SIZE).fill(0));
}

export function cloneGrid(grid: Grid): Grid {
  return grid.map((row) => row.slice());
}

/**
 * 取某一行/列上第 step 个格子的坐标。
 * step 从「移动方向的目标边」开始数：向左时 step 0 是最左边。
 */
function cellAt(direction: Direction, line: number, step: number): [number, number] {
  if (direction === "left") return [line, step];
  if (direction === "right") return [line, SIZE - 1 - step];
  if (direction === "up") return [step, line];
  return [SIZE - 1 - step, line];
}

interface SourceCell {
  row: number;
  col: number;
  value: number;
}

interface Slot {
  /** 合并后的数值。 */
  value: number;
  /** 合并前参与这个格子的源块。 */
  sources: SourceCell[];
}

/**
 * 滑动一次棋盘。
 *
 * 2048 的核心规则：按移动方向逐行/逐列压紧，同值只合并一次；
 * 合并后的新值不会在同一次滑动里再次参与合并（例如 [2,2,4,0] 向左得 [4,4,0,0]）。
 */
export function slide(grid: Grid, direction: Direction): MoveResult {
  const out = emptyGrid();
  const slides: Slide[] = [];
  const merges: Merge[] = [];
  let gained = 0;

  for (let line = 0; line < SIZE; line += 1) {
    const slots: Slot[] = [];

    for (let step = 0; step < SIZE; step += 1) {
      const [row, col] = cellAt(direction, line, step);
      const value = grid[row]?.[col] ?? 0;
      if (value === 0) continue;

      const last = slots[slots.length - 1];
      if (last && last.sources.length === 1 && last.value === value) {
        last.value = value * 2;
        last.sources.push({ row, col, value });
        gained += last.value;
      } else {
        slots.push({ value, sources: [{ row, col, value }] });
      }
    }

    for (let target = 0; target < slots.length; target += 1) {
      const slot = slots[target];
      if (!slot) continue;
      const [row, col] = cellAt(direction, line, target);
      out[row]![col] = slot.value;

      if (slot.sources.length > 1) merges.push({ row, col, value: slot.value });

      for (const source of slot.sources) {
        slides.push({
          fromRow: source.row,
          fromCol: source.col,
          toRow: row,
          toCol: col,
          value: source.value,
        });
      }
    }
  }

  let moved = false;
  for (let row = 0; row < SIZE && !moved; row += 1) {
    for (let col = 0; col < SIZE; col += 1) {
      if (out[row]![col] !== (grid[row]?.[col] ?? 0)) {
        moved = true;
        break;
      }
    }
  }

  return { moved, grid: out, gained, slides, merges };
}

/** 是否还有可走的步：有空格，或横/纵相邻有同值。 */
export function canMove(grid: Grid): boolean {
  for (let row = 0; row < SIZE; row += 1) {
    for (let col = 0; col < SIZE; col += 1) {
      const value = grid[row]?.[col] ?? 0;
      if (value === 0) return true;
      if (col + 1 < SIZE && grid[row]?.[col + 1] === value) return true;
      if (row + 1 < SIZE && grid[row + 1]?.[col] === value) return true;
    }
  }
  return false;
}

/** 棋盘上最大的数字，空棋盘为 0。 */
export function maxTile(grid: Grid): number {
  let best = 0;
  for (const row of grid) {
    for (const value of row) {
      if (value > best) best = value;
    }
  }
  return best;
}

/**
 * 在随机空格生成新块：90% 是 2，10% 是 4。
 * 返回新棋盘，原棋盘保持不变；rng 可注入，方便测试。
 */
export function spawnTile(grid: Grid, rng: () => number = Math.random): SpawnResult {
  const empty: { row: number; col: number }[] = [];
  for (let row = 0; row < SIZE; row += 1) {
    for (let col = 0; col < SIZE; col += 1) {
      if ((grid[row]?.[col] ?? 0) === 0) empty.push({ row, col });
    }
  }

  if (empty.length === 0) return { grid: cloneGrid(grid), spawn: null };

  const index = Math.min(empty.length - 1, Math.floor(rng() * empty.length));
  const cell = empty[index];
  if (!cell) return { grid: cloneGrid(grid), spawn: null };

  const value = rng() < 0.9 ? 2 : 4;
  const next = cloneGrid(grid);
  next[cell.row]![cell.col] = value;
  return { grid: next, spawn: { row: cell.row, col: cell.col, value } };
}
