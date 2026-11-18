/**
 * 俄罗斯方块的纯逻辑：棋盘、7-bag、碰撞、旋转/踢墙、消行、计分。
 *
 * 不依赖 DOM，可以直接被 vitest 覆盖；所有旋转态在模块加载时算好，
 * 运行时的移动/旋转只返回新的 Piece 对象，不会重新生成形状数组。
 */

export const COLS = 10;
export const ROWS = 20;

export const PIECE_KINDS = ["I", "O", "T", "S", "Z", "J", "L"] as const;
export type PieceKind = (typeof PIECE_KINDS)[number];

/** 单格坐标 [列, 行]。 */
export type Cell = readonly [number, number];
export type Shape = readonly Cell[];
/** 棋盘：0 = 空，其余见 KIND_ID。 */
export type Board = Uint8Array;

/** 方块在棋盘里的数字编码。 */
export const KIND_ID: Record<PieceKind, number> = {
  I: 1,
  O: 2,
  T: 3,
  S: 4,
  Z: 5,
  J: 6,
  L: 7,
};

/** 反查表，绘制时按格子里的数字取颜色。 */
export const KIND_BY_ID: readonly (PieceKind | null)[] = [
  null,
  "I",
  "O",
  "T",
  "S",
  "Z",
  "J",
  "L",
];

/** 0 号旋转态的原始坐标（之后统一归一化到左上角）。 */
const BASE: Record<PieceKind, Shape> = {
  I: [[0, 1], [1, 1], [2, 1], [3, 1]],
  O: [[0, 0], [1, 0], [0, 1], [1, 1]],
  T: [[1, 0], [0, 1], [1, 1], [2, 1]],
  S: [[1, 0], [2, 0], [0, 1], [1, 1]],
  Z: [[0, 0], [1, 0], [1, 1], [2, 1]],
  J: [[0, 0], [0, 1], [1, 1], [2, 1]],
  L: [[2, 0], [0, 1], [1, 1], [2, 1]],
};

/** 平移到左上角，保证每个旋转态都能用 (0,0) 作包围盒起点。 */
function normalize(cells: Shape): Shape {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  for (const [x, y] of cells) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
  }
  const out: Cell[] = [];
  for (const [x, y] of cells) out.push([x - minX, y - minY]);
  return out;
}

/** 规格里的旋转公式：(x, y) -> (y, -x)，再归一化。 */
export function rotateShape(shape: Shape): Shape {
  const turned: Cell[] = [];
  for (const [x, y] of shape) turned.push([y, -x]);
  return normalize(turned);
}

/** 每种方块 4 个旋转态，模块加载时一次算好。 */
export const SHAPES: Record<PieceKind, readonly Shape[]> = (() => {
  const table = {} as Record<PieceKind, readonly Shape[]>;
  for (const kind of PIECE_KINDS) {
    const states: Shape[] = [normalize(BASE[kind])];
    for (let i = 1; i < 4; i += 1) {
      states.push(rotateShape(states[i - 1]));
    }
    table[kind] = states;
  }
  return table;
})();

export interface Piece {
  kind: PieceKind;
  /** 0–3，对应 SHAPES[kind] 的下标。 */
  rotation: number;
  x: number;
  y: number;
}

export function emptyBoard(): Board {
  return new Uint8Array(COLS * ROWS);
}

export function pieceWidth(kind: PieceKind, rotation = 0): number {
  let max = 0;
  for (const [x] of SHAPES[kind][rotation]) if (x > max) max = x;
  return max + 1;
}

export function pieceHeight(kind: PieceKind, rotation = 0): number {
  let max = 0;
  for (const [, y] of SHAPES[kind][rotation]) if (y > max) max = y;
  return max + 1;
}

/** 出生列：按 0 号旋转态的宽度水平居中。 */
export function spawnX(kind: PieceKind): number {
  return Math.floor((COLS - pieceWidth(kind, 0)) / 2);
}

export function makePiece(kind: PieceKind, rotation = 0, x = spawnX(kind), y = 0): Piece {
  return { kind, rotation, x, y };
}

/** 给定位置是否与墙/地板/已堆方块冲突。 */
export function collidesAt(
  board: Board,
  kind: PieceKind,
  rotation: number,
  x: number,
  y: number,
): boolean {
  const shape = SHAPES[kind][rotation];
  for (const [dx, dy] of shape) {
    const cx = x + dx;
    const cy = y + dy;
    if (cx < 0 || cx >= COLS || cy >= ROWS) return true;
    if (cy >= 0 && board[cy * COLS + cx] !== 0) return true;
  }
  return false;
}

export function collides(board: Board, piece: Piece): boolean {
  return collidesAt(board, piece.kind, piece.rotation, piece.x, piece.y);
}

/** 平移一步；失败返回 null。 */
export function moved(board: Board, piece: Piece, dx: number, dy: number): Piece | null {
  const next: Piece = {
    kind: piece.kind,
    rotation: piece.rotation,
    x: piece.x + dx,
    y: piece.y + dy,
  };
  return collides(board, next) ? null : next;
}

/** 顺时针转一次；左右各试 1 格的简单踢墙。 */
export function rotated(board: Board, piece: Piece): Piece | null {
  const rotation = (piece.rotation + 1) % 4;
  for (const kick of [0, -1, 1]) {
    const next: Piece = { kind: piece.kind, rotation, x: piece.x + kick, y: piece.y };
    if (!collides(board, next)) return next;
  }
  return null;
}

/** 把方块写进棋盘，返回新棋盘（不修改入参）。 */
export function stamp(board: Board, piece: Piece): Board {
  const out = board.slice();
  const id = KIND_ID[piece.kind];
  const shape = SHAPES[piece.kind][piece.rotation];
  for (const [dx, dy] of shape) {
    const x = piece.x + dx;
    const y = piece.y + dy;
    if (x >= 0 && x < COLS && y >= 0 && y < ROWS) out[y * COLS + x] = id;
  }
  return out;
}

/** 当前方块下方还能掉几格（ghost / 硬降共用）。 */
export function dropDistance(board: Board, piece: Piece): number {
  let dist = 0;
  while (!collidesAt(board, piece.kind, piece.rotation, piece.x, piece.y + dist + 1)) {
    dist += 1;
  }
  return dist;
}

/** 找出所有填满的行，升序。 */
export function fullRows(board: Board): number[] {
  const rows: number[] = [];
  for (let row = 0; row < ROWS; row += 1) {
    let filled = 0;
    for (let col = 0; col < COLS; col += 1) {
      if (board[row * COLS + col] !== 0) filled += 1;
    }
    if (filled === COLS) rows.push(row);
  }
  return rows;
}

/** 移除指定行，剩余行整体下落，返回新棋盘。 */
export function clearRows(board: Board, rows: readonly number[]): Board {
  const drop = new Set(rows);
  const out = emptyBoard();
  let write = ROWS - 1;
  for (let read = ROWS - 1; read >= 0; read -= 1) {
    if (drop.has(read)) continue;
    for (let col = 0; col < COLS; col += 1) {
      out[write * COLS + col] = board[read * COLS + col];
    }
    write -= 1;
  }
  return out;
}

const LINE_SCORES = [0, 100, 300, 500, 800] as const;

/** 消行得分：1/2/3/4 行 = 100/300/500/800 × 等级。 */
export function lineScore(count: number, level: number): number {
  const base = LINE_SCORES[Math.min(Math.max(count, 0), 4)] ?? 0;
  return base * Math.max(1, level);
}

/** 每 10 行升 1 级，等级上限 99（HUD 两位）。 */
export function levelFor(lines: number): number {
  return Math.min(99, 1 + Math.floor(Math.max(0, lines) / 10));
}

/** 每级 -60ms，最低 120ms。 */
export function gravityFor(level: number): number {
  return Math.max(120, 800 - (Math.max(1, level) - 1) * 60);
}

/** 7-bag：洗好一整袋 7 种，抽完再洗下一袋。 */
export function shuffledBag(rng: () => number = Math.random): PieceKind[] {
  const bag = PIECE_KINDS.slice();
  for (let i = bag.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = bag[i];
    bag[i] = bag[j];
    bag[j] = tmp;
  }
  return bag;
}
