/**
 * 十三路五子棋纯规则层：棋盘几何、落子、连五判定、AI 评分与选点。
 *
 * 不碰 DOM / Canvas、也不调 Math.random：随机源一律由调用方注入，
 * 所以「连五判定」「必胜/必堵」「AI 可被击败」都能直接单测。
 *
 * 棋盘是一维数组，`index = row * SIZE + col`，取值 0 空 / 1 黑（玩家）/ 2 白（AI）。
 */

export const SIZE = 13;
/** 连满五子即胜。 */
export const WIN_LEN = 5;
/** 格子边长（逻辑像素）。 */
export const CELL = 12;
/** 棋盘左上角原点（逻辑像素）。 */
export const ORIGIN = 6;
export const CELLS = SIZE * SIZE;

/** 空格。 */
export const EMPTY = 0;
/** 黑子：玩家先行。 */
export const PLAYER = 1;
/** 白子：AI。 */
export const AI = 2;

/** 三局两胜：最多下 3 局，先赢 2 局者立即结束。 */
export const ROUNDS = 3;
/** 每赢一局的基础分。 */
export const WIN_ROUND_POINTS = 500;
/** 零封对手（2:0）的额外奖励。 */
export const SWEEP_BONUS = 200;
/** 键盘光标开局位置：天元。 */
export const START_CURSOR = 6 * SIZE + 6;

/** 四个方向：横、竖、正斜（右下）、反斜（右上）。 */
export const DIRECTIONS: readonly (readonly [number, number])[] = [
  [1, 0],
  [0, 1],
  [1, 1],
  [1, -1],
];

/** 连子长度 → 基础分，规格要求的 `10^连子数` 量级。 */
const LEN_SCORE: readonly number[] = [0, 10, 100, 1_000, 10_000];
/** 这一手已经能连五时的分数，压过其它一切。 */
const WIN_SCORE = 1_000_000;
/** 评分阶段的防守权重：略小于 1，让 AI 优先做自己的棋，不会一味道堵。 */
const DEFEND_WEIGHT = 0.85;
/** 平手容差：分数差在此之内随机取一个，避免每局都走同一条线。 */
const TIE_TOLERANCE = 1;

/**
 * AI 的失误率：在既不能自己连五、也不是必堵的普通局面下，
 * 有这一概率不从最高分落子，而是从高分候选里随便挑一个。
 *
 * 规格硬性要求 AI **必须可被击败**（40 局里玩家至少赢 5 局）。
 * 必胜 / 必堵 / 活四这些硬规则全部保留，只有普通局面的手感靠这点扰动松一松。
 * 调大 = AI 更弱。测试 `AI 必须可被击败` 会锁死这条下限。
 */
export const BLUNDER_RATE = 0.12;
/** 失误时从评分最高的这么多个候选点里随机挑一个（不是全盘乱下）。 */
const BLUNDER_DEPTH = 4;

/** 坐标 → 一维下标；调用方保证落在盘内。 */
export function cellToIndex(col: number, row: number): number {
  return row * SIZE + col;
}

/** 一维下标 → 坐标；越界返回 (-1, -1)。 */
export function indexToCell(index: number): { col: number; row: number } {
  if (!Number.isInteger(index) || index < 0 || index >= CELLS) return { col: -1, row: -1 };
  const row = Math.floor(index / SIZE);
  return { col: index - row * SIZE, row };
}

/**
 * 棋盘交叉点的中心坐标：`6 + col * 12 + 6`。
 * 棋子画在这里，不画在格子中心。
 */
export function cellCenter(col: number, row: number): { x: number; y: number } {
  return {
    x: ORIGIN + col * CELL + Math.floor(CELL / 2),
    y: ORIGIN + row * CELL + Math.floor(CELL / 2),
  };
}

/** 空棋盘：169 个 0。 */
export function emptyBoard(): number[] {
  return new Array<number>(CELLS).fill(EMPTY);
}

/** 全部空点（下标升序，保证可复现）。 */
export function legalMoves(board: number[]): number[] {
  const moves: number[] = [];
  for (let index = 0; index < CELLS; index += 1) {
    if ((board[index] ?? EMPTY) === EMPTY) moves.push(index);
  }
  return moves;
}

/** 棋盘是否已下满（平局判定）。 */
export function isFull(board: number[]): boolean {
  for (let index = 0; index < CELLS; index += 1) {
    if ((board[index] ?? EMPTY) === EMPTY) return false;
  }
  return true;
}

/** 对手颜色。 */
export function opponentOf(who: number): number {
  return who === PLAYER ? AI : PLAYER;
}

const isOnBoard = (col: number, row: number): boolean =>
  col >= 0 && col < SIZE && row >= 0 && row < SIZE;

const at = (board: number[], col: number, row: number): number => board[row * SIZE + col] ?? EMPTY;

/** 从 (col,row) 出发沿 (dx,dy) 连着的同色子数（不含起点）。 */
function runLength(
  board: number[],
  col: number,
  row: number,
  dx: number,
  dy: number,
  who: number,
): number {
  let count = 0;
  let c = col + dx;
  let r = row + dy;
  while (isOnBoard(c, r) && at(board, c, r) === who) {
    count += 1;
    c += dx;
    r += dy;
  }
  return count;
}

/** 假设在空点 (col,row) 落一子后，某方向上的连通长度与两端空位数。 */
interface Shape {
  /** 含假设落子的连续同色子数。 */
  length: number;
  /** 两端里能继续落子的端数（0 到 2）。 */
  open: number;
}

function shapeAt(
  board: number[],
  col: number,
  row: number,
  dx: number,
  dy: number,
  who: number,
): Shape {
  const forward = runLength(board, col, row, dx, dy, who);
  const backward = runLength(board, col, row, -dx, -dy, who);
  const length = forward + backward + 1;

  let open = 0;
  const fCol = col + dx * (forward + 1);
  const fRow = row + dy * (forward + 1);
  if (isOnBoard(fCol, fRow) && at(board, fCol, fRow) === EMPTY) open += 1;
  const bCol = col - dx * (backward + 1);
  const bRow = row - dy * (backward + 1);
  if (isOnBoard(bCol, bRow) && at(board, bCol, bRow) === EMPTY) open += 1;

  return { length, open };
}

/**
 * 胜负判定：只看落子点所在的四条线。
 * 返回赢家（1 / 2），无人连五返回 0。
 */
export function checkWin(board: number[], index: number): 0 | 1 | 2 {
  if (!Number.isInteger(index) || index < 0 || index >= CELLS) return 0;
  const who = board[index] ?? EMPTY;
  if (who !== PLAYER && who !== AI) return 0;

  const col = index % SIZE;
  const row = (index - col) / SIZE;

  for (const [dx, dy] of DIRECTIONS) {
    const length =
      runLength(board, col, row, dx, dy, who) + runLength(board, col, row, -dx, -dy, who) + 1;
    if (length >= WIN_LEN) return who as 1 | 2;
  }
  return 0;
}

/**
 * 单个空点的评分：四个方向各统计「以该点为轴的连子数」，
 * 给 `10^连子数` 量级的分，两端都空的活棋额外翻倍。
 *
 * 已经能连五直接返回 `WIN_SCORE`（必胜点）。
 * 已占点 / 非法点返回 0。
 */
export function scoreCell(board: number[], index: number, who: number): number {
  if (!Number.isInteger(index) || index < 0 || index >= CELLS) return 0;
  if ((board[index] ?? EMPTY) !== EMPTY) return 0;
  if (who !== PLAYER && who !== AI) return 0;

  const col = index % SIZE;
  const row = (index - col) / SIZE;
  let total = 0;

  for (const [dx, dy] of DIRECTIONS) {
    const shape = shapeAt(board, col, row, dx, dy, who);
    if (shape.length >= WIN_LEN) return WIN_SCORE;
    const base = LEN_SCORE[Math.min(shape.length, WIN_LEN - 1)] ?? 0;
    const factor = shape.open === 2 ? 2 : shape.open === 1 ? 1 : 0;
    total += base * factor;
  }

  return total;
}

/** 在空点落子后是否形成「活四」（四连且两端都空，下一手必赢）。 */
function makesOpenFour(board: number[], index: number, who: number): boolean {
  const col = index % SIZE;
  const row = (index - col) / SIZE;
  for (const [dx, dy] of DIRECTIONS) {
    const shape = shapeAt(board, col, row, dx, dy, who);
    if (shape.length === WIN_LEN - 1 && shape.open === 2) return true;
  }
  return false;
}

/** 候选点：已有棋子周围 2 格范围内的空点（规格要求的评分窗口）。 */
export function candidateMoves(board: number[]): number[] {
  let anyStone = false;
  for (let index = 0; index < CELLS; index += 1) {
    if ((board[index] ?? EMPTY) !== EMPTY) {
      anyStone = true;
      break;
    }
  }
  // 空盘：落在天元。
  if (!anyStone) return [cellToIndex(Math.floor(SIZE / 2), Math.floor(SIZE / 2))];

  const near = new Uint8Array(CELLS);
  for (let index = 0; index < CELLS; index += 1) {
    if ((board[index] ?? EMPTY) === EMPTY) continue;
    const col = index % SIZE;
    const row = (index - col) / SIZE;
    for (let dy = -2; dy <= 2; dy += 1) {
      for (let dx = -2; dx <= 2; dx += 1) {
        const c = col + dx;
        const r = row + dy;
        if (!isOnBoard(c, r)) continue;
        const point = r * SIZE + c;
        if ((board[point] ?? EMPTY) === EMPTY) near[point] = 1;
      }
    }
  }

  const list: number[] = [];
  for (let index = 0; index < CELLS; index += 1) if (near[index] === 1) list.push(index);
  return list;
}

/** 把 rng 的返回值夹进 [0, 1)，极端值也不会让选点炸掉。 */
function unit(rand: () => number): number {
  const raw = rand();
  if (!Number.isFinite(raw) || raw <= 0) return 0;
  if (raw >= 1) return 0.999999999;
  return raw;
}

/**
 * 在一组候选点里挑最高分：进攻分 + 防守分 × 权重。
 * 分数差落在容差内的点随机取一个（消耗一次随机源）。
 *
 * `allowBlunder` 为真时按 `BLUNDER_RATE` 放宽到「前 BLUNDER_DEPTH 名里随机」，
 * 这是让 AI 可被击败的主要旋钮；必胜 / 必堵 / 活四这些硬规则不过这里。
 */
function pickBest(
  board: number[],
  list: readonly number[],
  who: number,
  foe: number,
  rand: () => number,
  allowBlunder: boolean,
): number {
  const scored = list.map((index) => ({
    index,
    score: scoreCell(board, index, who) + scoreCell(board, index, foe) * DEFEND_WEIGHT,
  }));
  scored.sort((a, b) => b.score - a.score || a.index - b.index);

  if (allowBlunder && scored.length > 1 && unit(rand) < BLUNDER_RATE) {
    const depth = Math.min(BLUNDER_DEPTH, scored.length);
    const pick = Math.min(depth - 1, Math.floor(unit(rand) * depth));
    return (scored[pick] as { index: number }).index;
  }

  const best = (scored[0] as { score: number }).score;
  const ties = scored.filter((item) => best - item.score <= TIE_TOLERANCE);
  const pick = ties[Math.min(ties.length - 1, Math.floor(unit(rand) * ties.length))];
  return (pick as { index: number }).index;
}

/**
 * AI 选点，优先级与 `docs/game-specs-vol03.md` 第 26 节一致：
 *
 * 1. 自己能连五 → 直接下（赢）。
 * 2. 对手下一步能连五 → 堵最痛的一处（多处时本就堵不住，仍挑分最高的一处）。
 * 3. 自己能做出活四 → 直接下（下一手必赢）。
 * 4. 否则按 `scoreCell` 评分：候选点取周围 2 格范围，进攻 + 防守加权，平手随机。
 *
 * 规格硬性要求 AI **可被击败**，所以这里**不做**多手搜索、也不逐个封死活三：
 * 玩家靠连成活三再成活四的次序就能赢，评分权重与随机扰动保证 AI 不会全胜。
 * 不修改传入的棋盘；无空点返回 -1。
 *
 * `rand` 必须由调用方注入 —— 本文件不碰 `Math.random`，保证逻辑层可复现。
 */
export function bestMove(board: number[], ai: number, rand: () => number): number {
  const who = ai === AI ? AI : PLAYER;
  const foe = opponentOf(who);

  const window = candidateMoves(board);
  const moves = window.length > 0 ? window : legalMoves(board);
  if (moves.length === 0) return -1;

  const sim = board.slice();

  // 1. 自己能连五 → 立刻赢。
  for (const index of moves) {
    sim[index] = who;
    const win = checkWin(sim, index) === who;
    sim[index] = EMPTY;
    if (win) return index;
  }

  // 2. 对手下一步能连五 → 必须堵；有多处说明已经堵不住，仍挑分最高的一处。
  const blocks: number[] = [];
  for (const index of moves) {
    sim[index] = foe;
    const threat = checkWin(sim, index) === foe;
    sim[index] = EMPTY;
    if (threat) blocks.push(index);
  }
  if (blocks.length > 0) return pickBest(board, blocks, who, foe, rand, false);

  // 3. 自己能做出活四 → 下一手必赢。
  const fours: number[] = [];
  for (const index of moves) {
    if (makesOpenFour(board, index, who)) fours.push(index);
  }
  if (fours.length > 0) return pickBest(board, fours, who, foe, rand, false);

  // 3b. 对手能做出活四 → 必须抢先把这一手占掉（规格的「相应防守」）。
  const blocksFour = moves.filter((index) => makesOpenFour(board, index, foe));
  if (blocksFour.length > 0) return pickBest(board, blocksFour, who, foe, rand, false);

  // 4. 评分选点（候选点周围 2 格，平手随机；普通局面允许偶尔失误）。
  return pickBest(board, moves, who, foe, rand, true);
}

/**
 * 落子点所在的五连（含更长）整段下标，按沿线先后顺序返回。
 * 只用于把获胜的那条线画出来；没有五连返回空数组。
 */
export function winningLine(board: number[], index: number): number[] {
  if (!Number.isInteger(index) || index < 0 || index >= CELLS) return [];
  const who = board[index] ?? EMPTY;
  if (who !== PLAYER && who !== AI) return [];

  const col = index % SIZE;
  const row = (index - col) / SIZE;

  for (const [dx, dy] of DIRECTIONS) {
    const forward = runLength(board, col, row, dx, dy, who);
    const backward = runLength(board, col, row, -dx, -dy, who);
    if (forward + backward + 1 < WIN_LEN) continue;

    const line: number[] = [];
    for (let step = -backward; step <= forward; step += 1) {
      line.push((row + dy * step) * SIZE + (col + dx * step));
    }
    return line;
  }
  return [];
}

/**
 * 光标移动：四向各走一格，到边停住（不环绕、不越界）。
 * 非方向动作原样返回。
 */
export function cursorStep(index: number, action: string): number {
  const safe = Number.isInteger(index) && index >= 0 && index < CELLS ? index : START_CURSOR;
  const col = safe % SIZE;
  const row = (safe - col) / SIZE;

  switch (action) {
    case "left":
      return cellToIndex(Math.max(0, col - 1), row);
    case "right":
      return cellToIndex(Math.min(SIZE - 1, col + 1), row);
    case "up":
      return cellToIndex(col, Math.max(0, row - 1));
    case "down":
      return cellToIndex(col, Math.min(SIZE - 1, row + 1));
    default:
      return safe;
  }
}

/**
 * 整场的分数：每赢一局 +500，2:0 零封再 +200。
 * 输 / 平都是 0 分，所以三局总分落在 0 到 1200，HUD 的 5 位足够。
 */
export function roundPoints(wins: number, losses: number): number {
  if (wins <= 0) return 0;
  const base = wins * WIN_ROUND_POINTS;
  return losses === 0 && wins >= 2 ? base + SWEEP_BONUS : base;
}

/** 三局两胜是否已经分出胜负（任一方先到 2 胜）。 */
export function matchDecided(wins: number, losses: number): boolean {
  return wins >= 2 || losses >= 2;
}
