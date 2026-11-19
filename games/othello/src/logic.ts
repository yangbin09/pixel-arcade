/**
 * 黑白棋（Reversi）纯规则层：棋盘、合法手、八方向翻转、终局判定、AI、计分。
 *
 * 不碰 DOM / Canvas，随机源由调用方注入（默认 Math.random），
 * 所以「开局黑只有 4 个合法手」「八方向翻转」「AI 必落合法手」都能直接单测。
 *
 * 棋盘是一维数组，`index = y * SIZE + x`，格子值只用 EMPTY / BLACK / WHITE。
 */

export const SIZE = 8;
export const CELLS = SIZE * SIZE;

/** 格子状态：0 空、1 黑、2 白。 */
export const EMPTY = 0;
export const BLACK = 1;
export const WHITE = 2;

export type Disc = typeof EMPTY | typeof BLACK | typeof WHITE;
export type Color = typeof BLACK | typeof WHITE;
/** 棋盘：长度 64 的一维数组（原地修改的函数会写明，其余都返回新盘）。 */
export type Board = Disc[];

/** 一局棋由 3 个小局组成，小局分数累加成本局总分。 */
export const ROUNDS = 3;

/** 玩家执黑先行，AI 执白。 */
export const PLAYER_COLOR: Color = BLACK;
export const AI_COLOR: Color = WHITE;

/** 每局计分：赢 +100 / 平 +30 / 输 0，再加上子数差。 */
export const WIN_POINTS = 100;
export const DRAW_POINTS = 30;

/** 八方向：东、西、南、北、东南、西南、东北、西北。 */
const DIRECTIONS: readonly (readonly [number, number])[] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];

/** 四角：占住就不会被翻，价值最高。 */
export const CORNERS: readonly number[] = [
  indexOf(0, 0),
  indexOf(SIZE - 1, 0),
  indexOf(0, SIZE - 1),
  indexOf(SIZE - 1, SIZE - 1),
];

/** 角邻（星位旁边的 X 位 / C 位）：把角让给对手，通常是坏棋。 */
export const CORNER_ADJACENT: readonly number[] = buildCornerAdjacent();
const CORNER_SET = new Set<number>(CORNERS);
const CORNER_ADJACENT_SET = new Set<number>(CORNER_ADJACENT);

/** AI 评分权重，规格里写死的那套。 */
export const FLIP_WEIGHT = 10;
export const CORNER_BONUS = 60;
export const CORNER_ADJACENT_BONUS = -25;
export const AI_RANDOM_BONUS = 8;

/** 默认光标：棋盘中心偏左，开局不用从角落挪。 */
export const START_CURSOR = indexOf(3, 3);

/** (x, y) → 一维下标；调用方保证在盘内。 */
export function indexOf(x: number, y: number): number {
  return y * SIZE + x;
}

/** 一维下标 → x。 */
export function xOf(index: number): number {
  return index % SIZE;
}

/** 一维下标 → y。 */
export function yOf(index: number): number {
  return Math.floor(index / SIZE);
}

function buildCornerAdjacent(): number[] {
  const list: number[] = [];
  for (const corner of CORNERS) {
    const cx = xOf(corner);
    const cy = yOf(corner);
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        if (dx === 0 && dy === 0) continue;
        const x = cx + dx;
        const y = cy + dy;
        if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) continue;
        const index = indexOf(x, y);
        if (!list.includes(index)) list.push(index);
      }
    }
  }
  return list;
}

/** 空棋盘：64 格全空。 */
export function createBoard(): Board {
  return new Array<Disc>(CELLS).fill(EMPTY);
}

/** 拷贝一份盘面，避免调用方改到原棋盘。 */
export function cloneBoard(board: Board): Board {
  return board.slice(0, CELLS);
}

/**
 * 开局四子：中央黑白各两子。
 *
 * 采用「白在 d4/e5、黑在 e4/d5」的摆法（0 起坐标）：
 * (3,3) 白、(4,3) 黑、(3,4) 黑、(4,4) 白 —— 黑先手。
 */
export function initialBoard(): Board {
  const board = createBoard();
  board[indexOf(3, 3)] = WHITE;
  board[indexOf(4, 3)] = BLACK;
  board[indexOf(3, 4)] = BLACK;
  board[indexOf(4, 4)] = WHITE;
  return board;
}

/** 对手颜色。 */
export function opponentOf(color: Color): Color {
  return color === BLACK ? WHITE : BLACK;
}

/**
 * 在 idx 落 color 子能翻转的**全部**棋子（八方向逐个执行，不设上限）。
 *
 * 某方向必须「紧邻至少一子对手、且线段末尾是一枚己方子」才成立；
 * 翻不过去的位置返回空数组，因此 `flipsFor(...).length > 0` 就是合法手。
 * 不修改棋盘。
 */
export function flipsFor(board: Board, idx: number, color: Color): number[] {
  if (!Number.isInteger(idx) || idx < 0 || idx >= CELLS) return [];
  if (board[idx] !== EMPTY) return [];

  const foe = opponentOf(color);
  const col = xOf(idx);
  const row = yOf(idx);
  const out: number[] = [];

  for (const [dx, dy] of DIRECTIONS) {
    const line: number[] = [];
    let x = col + dx;
    let y = row + dy;

    // 先沿方向吃掉连续的对子；遇到空位 / 己方 / 出界就停。
    while (x >= 0 && x < SIZE && y >= 0 && y < SIZE) {
      const cell = board[indexOf(x, y)];
      if (cell !== foe) break;
      line.push(indexOf(x, y));
      x += dx;
      y += dy;
    }

    // 只有「吃到至少一子，且线段尽头是己方子」这个方向才真正翻转。
    if (line.length === 0) continue;
    if (x < 0 || x >= SIZE || y < 0 || y >= SIZE) continue;
    if (board[indexOf(x, y)] !== color) continue;
    out.push(...line);
  }

  return out;
}

/** 合法手判定：空位 + 至少一个方向能夹住并翻转。 */
export function isLegal(board: Board, idx: number, color: Color): boolean {
  return flipsFor(board, idx, color).length > 0;
}

/** 当前所有合法手（下标升序，保证可复现）。 */
export function legalMoves(board: Board, color: Color): number[] {
  const moves: number[] = [];
  for (let idx = 0; idx < CELLS; idx += 1) {
    if (board[idx] !== EMPTY) continue;
    if (flipsFor(board, idx, color).length > 0) moves.push(idx);
  }
  return moves;
}

/**
 * 落子：返回**新盘**（原盘不动），落子处变己方色，所有可翻子一并翻。
 * 非法手原样返回一份拷贝。
 */
export function applyMove(board: Board, idx: number, color: Color): Board {
  const next = cloneBoard(board);
  const flips = flipsFor(next, idx, color);
  if (flips.length === 0) return next;
  next[idx] = color;
  for (const index of flips) next[index] = color;
  return next;
}

/** 数盘面：黑白各多少子，空位多少。 */
export function countDiscs(board: Board): { black: number; white: number; empty: number } {
  let black = 0;
  let white = 0;
  for (let idx = 0; idx < CELLS; idx += 1) {
    const cell = board[idx];
    if (cell === BLACK) black += 1;
    else if (cell === WHITE) white += 1;
  }
  return { black, white, empty: CELLS - black - white };
}

/**
 * 终局判定：双方都没有合法手才算本局结束。
 *
 * 注意「一方被子吃光」也自然成立 —— 没有子的一方永远翻不出合法手。
 */
export function isGameOver(board: Board): boolean {
  if (legalMoves(board, BLACK).length > 0) return false;
  if (legalMoves(board, WHITE).length > 0) return false;
  return true;
}

/** 把 rng 的返回值夹进 [0, 1)，极端值（1 / NaN）也不会让评分炸掉。 */
function unitRandom(rng: () => number): number {
  const raw = rng();
  if (!Number.isFinite(raw) || raw <= 0) return 0;
  if (raw >= 1) return 0.999999999;
  return raw;
}

/**
 * 单个合法手的 AI 评分：`翻转数*10 + 角 +60 / 角邻 -25 + 随机 0~8`。
 *
 * 消耗一次随机源；AI 只对合法手打分，所以调用方要保证 idx 合法
 * （`aiPick` 内部就是这么做的）。
 */
export function aiMoveScore(
  board: Board,
  idx: number,
  color: Color,
  rng: () => number = Math.random,
): number {
  const flips = flipsFor(board, idx, color).length;
  let bonus = 0;
  if (CORNER_SET.has(idx)) bonus += CORNER_BONUS;
  else if (CORNER_ADJACENT_SET.has(idx)) bonus += CORNER_ADJACENT_BONUS;
  return flips * FLIP_WEIGHT + bonus + unitRandom(rng) * AI_RANDOM_BONUS;
}

/**
 * AI 选点：对每个合法手打分取最高，**只会返回合法手**。
 * 无合法手时返回 -1（调用方据此弃手）。
 *
 * 给定同一个 rng 序列结果完全一致，因此可复现、可单测。
 */
export function aiPick(board: Board, color: Color, rng: () => number = Math.random): number {
  const moves = legalMoves(board, color);
  if (moves.length === 0) return -1;

  let best = -1;
  let bestScore = -Infinity;
  for (const idx of moves) {
    const score = aiMoveScore(board, idx, color, rng);
    if (score > bestScore) {
      bestScore = score;
      best = idx;
    }
  }
  return best;
}

/**
 * 一个小局的分数：赢 +100 / 平 +30 / 输 0，再加 `我方子数 - 对方子数`。
 * 返回值可能是负数（输棋且子差为负），由调用方夹到 HUD 位数里。
 */
export function scoreRound(mine: number, theirs: number): number {
  const diff = mine - theirs;
  const base = diff > 0 ? WIN_POINTS : diff === 0 ? DRAW_POINTS : 0;
  return base + diff;
}

/**
 * 光标移动：四向各走一格，到边停住（不环绕、不越界）。
 * 非方向动作原样返回。
 */
export function cursorStep(index: number, action: string): number {
  const safe = Number.isInteger(index) && index >= 0 && index < CELLS ? index : START_CURSOR;
  let x = xOf(safe);
  let y = yOf(safe);

  switch (action) {
    case "left":
      x = Math.max(0, x - 1);
      break;
    case "right":
      x = Math.min(SIZE - 1, x + 1);
      break;
    case "up":
      y = Math.max(0, y - 1);
      break;
    case "down":
      y = Math.min(SIZE - 1, y + 1);
      break;
    default:
      return safe;
  }
  return indexOf(x, y);
}

/** 光标落到最近的合法手（开局 / 弃手后把光标摆到能下的地方）。 */
export function firstLegalCursor(board: Board, color: Color): number {
  const moves = legalMoves(board, color);
  return moves.length > 0 ? (moves[0] as number) : START_CURSOR;
}
