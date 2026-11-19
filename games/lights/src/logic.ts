/**
 * 关灯谜题纯规则层：十字翻转、棋盘状态、打散生成、光标移动。
 *
 * 不碰 DOM / Canvas，随机源由调用方注入，
 * 所以「必定有解」「翻转两次复原」「光标不越界」都能直接单测。
 */

export const SIZE = 5;
export const CELLS = SIZE * SIZE;
/** 总关数：五关递进，五关步数相加就是本局低分成绩。 */
export const LEVELS = 5;

/** 棋盘：true = 灯亮，false = 灯灭。全灭即通关。 */
export type Board = boolean[];

/**
 * 打散结果。
 *
 * `path` 是打散时依次按下的格子序号；因为每次翻转都是自逆操作，
 * 把 `path` 反序再按一遍一定回到全灭 —— 这就是「必定有解」的证明。
 */
export interface Scramble {
  board: Board;
  path: number[];
  steps: number;
}

/**
 * 点击一格会翻转的**全部**格子（含自身）：角 3、边 4、中心 5。
 * 表是预计算的，返回的数组只读，避免调用方改坏邻域表。
 */
const TOGGLE_SETS: readonly (readonly number[])[] = buildToggleSets();

function buildToggleSets(): number[][] {
  const table: number[][] = [];
  for (let index = 0; index < CELLS; index += 1) {
    const row = Math.floor(index / SIZE);
    const col = index % SIZE;
    const list: number[] = [index];
    if (row > 0) list.push(index - SIZE);
    if (row < SIZE - 1) list.push(index + SIZE);
    if (col > 0) list.push(index - 1);
    if (col < SIZE - 1) list.push(index + 1);
    table.push(list);
  }
  return table;
}

export function neighborsOf(index: number): readonly number[] {
  return TOGGLE_SETS[index] ?? [];
}

/** 空格子：25 盏灯全灭（也就是已通关的状态）。 */
export function createBoard(): Board {
  return new Array<boolean>(CELLS).fill(false);
}

/** 拷贝一份盘面，单测和「反序回放」都用它，避免改到原棋盘。 */
export function cloneBoard(board: Board): Board {
  return board.slice(0, CELLS);
}

/** 点击一格：把它自己和上下左右邻居一起翻转。原地修改并返回同一个数组。 */
export function toggle(board: Board, index: number): Board {
  if (index < 0 || index >= CELLS) return board;
  for (const cell of neighborsOf(index)) board[cell] = !board[cell];
  return board;
}

/** 还亮着的灯数，HUD 的 left 栏直接用。 */
export function litCount(board: Board): number {
  let count = 0;
  for (let index = 0; index < CELLS; index += 1) {
    if (board[index]) count += 1;
  }
  return count;
}

/** 只认全灭：有一盏亮着就不算通关。 */
export function isSolved(board: Board): boolean {
  for (let index = 0; index < CELLS; index += 1) {
    if (board[index]) return false;
  }
  return true;
}

/**
 * 第 level 关（1 起）的打散步数。
 *
 * 规格里的公式是 `3 + level*2`，并且注明「第 1 关 3 步起」，
 * 所以公式里的 level 是 0 起的下标；对外用 1 起的关数，等价于
 * `3 + (level - 1) * 2` —— 第一关 3 步、第五关 11 步。
 */
export function scrambleSteps(level: number): number {
  const safe = Math.max(1, Math.floor(level));
  return 3 + (safe - 1) * 2;
}

/** 从 0..CELLS-1 里不重复地抽 count 个格子（部分洗牌，随机源可注入）。 */
function sampleCells(count: number, rng: () => number): number[] {
  const pool: number[] = [];
  for (let index = 0; index < CELLS; index += 1) pool.push(index);

  const picks: number[] = [];
  const n = Math.max(0, Math.min(Math.floor(count), CELLS));
  for (let i = 0; i < n; i += 1) {
    const raw = rng();
    const unit = raw >= 1 ? 0.999999 : raw <= 0 ? 0 : raw;
    const j = i + Math.floor(unit * (CELLS - i));
    const swap = pool[i] as number;
    pool[i] = pool[j] as number;
    pool[j] = swap;
    picks.push(pool[i] as number);
  }
  return picks;
}

/**
 * 生成第 level 关：从全灭状态随机按 `scrambleSteps(level)` 下，
 * 因此这一关一定可以用同一条路径反序解开。
 *
 * 同一组点击有可能互相抵消回全灭（5×5 的翻转矩阵有 2 维零空间），
 * 所以命中「生成即通关」时重投，极端情况下补按一格兜底，保证关卡非空。
 */
export function scramble(level: number, rng: () => number = Math.random): Scramble {
  const steps = scrambleSteps(level);

  for (let attempt = 0; attempt < 64; attempt += 1) {
    const board = createBoard();
    const path = sampleCells(steps, rng);
    for (const index of path) toggle(board, index);
    if (!isSolved(board)) return { board, path, steps };
  }

  // 兜底：固定顺序打散；万一正好互相抵消，就再补一格，仍然有解。
  const board = createBoard();
  const path = sampleCells(steps, () => 0);
  for (const index of path) toggle(board, index);
  if (isSolved(board)) {
    const extra = findUnsolvedSource(board);
    path.push(extra);
    toggle(board, extra);
  }
  return { board, path, steps: path.length };
}

/** 找一个按下去会让全灭变亮的格子（背水一战的兜底用）。 */
function findUnsolvedSource(board: Board): number {
  const probe = cloneBoard(board);
  for (let index = 0; index < CELLS; index += 1) {
    const copy = cloneBoard(probe);
    toggle(copy, index);
    if (!isSolved(copy)) return index;
  }
  return 0;
}

/**
 * 光标移动：四个方向各走一格，到边就停住（不环绕、不越界）。
 * 非方向动作原样返回。
 */
export function cursorStep(index: number, action: string, size: number = SIZE): number {
  const side = Math.max(1, Math.floor(size));
  const total = side * side;
  const safe = index >= 0 && index < total ? Math.floor(index) : 0;
  let row = Math.floor(safe / side);
  let col = safe % side;

  switch (action) {
    case "left":
      col = Math.max(0, col - 1);
      break;
    case "right":
      col = Math.min(side - 1, col + 1);
      break;
    case "up":
      row = Math.max(0, row - 1);
      break;
    case "down":
      row = Math.min(side - 1, row + 1);
      break;
    default:
      return safe;
  }
  return row * side + col;
}

/** 默认光标位置：棋盘正中，开局不用从角落挪。 */
export const START_CURSOR = Math.floor(CELLS / 2);
