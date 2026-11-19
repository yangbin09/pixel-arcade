import { describe, expect, it } from "vitest";

import {
  BLACK,
  CELLS,
  CORNER_ADJACENT,
  CORNERS,
  EMPTY,
  PLAYER_COLOR,
  ROUNDS,
  SIZE,
  WHITE,
  aiMoveScore,
  aiPick,
  applyMove,
  cloneBoard,
  countDiscs,
  createBoard,
  cursorStep,
  firstLegalCursor,
  flipsFor,
  indexOf,
  initialBoard,
  isGameOver,
  isLegal,
  legalMoves,
  opponentOf,
  scoreRound,
  xOf,
  yOf,
  type Board,
  type Color,
  type Disc,
} from "../src/logic";

/** 可复现随机源：同一个种子跑出同一串随机数。 */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

/** 用一张 8 行字符串摆盘：. 空 / B 黑 / W 白。 */
function boardOf(rows: readonly string[]): Board {
  const board = createBoard();
  for (let y = 0; y < rows.length; y += 1) {
    const row = rows[y] as string;
    for (let x = 0; x < row.length; x += 1) {
      const ch = row[x] as string;
      if (ch === "B") board[indexOf(x, y)] = BLACK;
      else if (ch === "W") board[indexOf(x, y)] = WHITE;
    }
  }
  return board;
}

/**
 * 白子被黑子锁死在角上、黑方还剩一手可下的局面。
 * 白方没有任何合法手（该弃手），黑方只有 (2,2) 一手。
 */
function lockedBoard(): Board {
  const board = new Array<Disc>(CELLS).fill(BLACK);
  board[indexOf(1, 1)] = WHITE;
  board[indexOf(2, 2)] = EMPTY;
  return board;
}

describe("棋盘常量与坐标", () => {
  it("8×8 共 64 格、三局、玩家执黑", () => {
    expect(SIZE).toBe(8);
    expect(CELLS).toBe(64);
    expect(ROUNDS).toBe(3);
    expect(PLAYER_COLOR).toBe(BLACK);
    expect(opponentOf(BLACK)).toBe(WHITE);
    expect(opponentOf(WHITE)).toBe(BLACK);
  });

  it("indexOf / xOf / yOf 互为逆运算", () => {
    for (let y = 0; y < SIZE; y += 1) {
      for (let x = 0; x < SIZE; x += 1) {
        const index = indexOf(x, y);
        expect(index).toBeGreaterThanOrEqual(0);
        expect(index).toBeLessThan(CELLS);
        expect(xOf(index)).toBe(x);
        expect(yOf(index)).toBe(y);
      }
    }
  });

  it("四角与角邻表落在正确的位置", () => {
    expect([...CORNERS].sort((a, b) => a - b)).toEqual([0, 7, 56, 63]);
    // 每个角 3 个非角邻位，四角共 12 个，且都不含角本身。
    expect(CORNER_ADJACENT).toHaveLength(12);
    for (const index of CORNERS) expect(CORNER_ADJACENT).not.toContain(index);
    expect(CORNER_ADJACENT).toContain(indexOf(1, 1));
    expect(CORNER_ADJACENT).toContain(indexOf(6, 0));
  });
});

describe("初始盘面", () => {
  it("createBoard 是 64 格全空", () => {
    const board = createBoard();
    expect(board).toHaveLength(CELLS);
    expect(board.every((cell) => cell === EMPTY)).toBe(true);
    expect(countDiscs(board)).toEqual({ black: 0, white: 0, empty: CELLS });
  });

  it("initialBoard 中央四子：黑白各两子", () => {
    const board = initialBoard();
    expect(countDiscs(board)).toEqual({ black: 2, white: 2, empty: 60 });
    // 中央 2×2：d4 白、e4 黑、d5 黑、e5 白（0 起坐标）。
    expect(board[indexOf(3, 3)]).toBe(WHITE);
    expect(board[indexOf(4, 3)]).toBe(BLACK);
    expect(board[indexOf(3, 4)]).toBe(BLACK);
    expect(board[indexOf(4, 4)]).toBe(WHITE);
  });

  it("开局黑恰好有 4 个合法手，白也恰好 4 个", () => {
    const board = initialBoard();
    const blackMoves = legalMoves(board, BLACK);
    const whiteMoves = legalMoves(board, WHITE);

    expect(blackMoves).toHaveLength(4);
    expect(whiteMoves).toHaveLength(4);
    // 四手分别落在中央 2×2 向外的四个方向上。
    expect([...blackMoves].sort((a, b) => a - b)).toEqual(
      [indexOf(2, 3), indexOf(3, 2), indexOf(4, 5), indexOf(5, 4)].sort((a, b) => a - b),
    );
    // 黑白合法手集合互补，互不重叠。
    for (const move of blackMoves) expect(whiteMoves).not.toContain(move);
  });

  it("初始盘面不是终局，且开局每一手都能真的翻子", () => {
    const board = initialBoard();
    expect(isGameOver(board)).toBe(false);
    for (const move of legalMoves(board, BLACK)) {
      expect(flipsFor(board, move, BLACK)).toHaveLength(1);
      expect(isLegal(board, move, BLACK)).toBe(true);
    }
  });
});

describe("八方向翻转", () => {
  it("横向翻三子", () => {
    const board = boardOf([
      "........",
      "........",
      "........",
      "BBWWW...",
      "........",
      "........",
      "........",
      "........",
    ]);
    expect(flipsFor(board, indexOf(5, 3), BLACK)).toEqual([
      indexOf(4, 3),
      indexOf(3, 3),
      indexOf(2, 3),
    ]);
  });

  it("纵向与斜向各自沿方向顺序翻转", () => {
    const vertical = boardOf([
      "........",
      "........",
      "........",
      "........",
      "..B.....",
      "..W.....",
      "..W.....",
      "........",
    ]);
    // 从上往下落子：先翻近的 (2,6)，再翻远的 (2,5)。
    expect(flipsFor(vertical, indexOf(2, 7), BLACK)).toEqual([
      indexOf(2, 6),
      indexOf(2, 5),
    ]);

    const diagonal = boardOf([
      "B.......",
      ".W......",
      "..W.....",
      "........",
      "........",
      "........",
      "........",
      "........",
    ]);
    expect(flipsFor(diagonal, indexOf(3, 3), BLACK)).toEqual([
      indexOf(2, 2),
      indexOf(1, 1),
    ]);
  });

  it("一手可同时翻转八个方向", () => {
    // 中心 (3,3) 空，八邻全是白子，八方向的下一格全是黑子。
    const cross = boardOf([
      "........",
      ".B.B.B..",
      "..WWW...",
      ".BW.WB..",
      "..WWW...",
      ".B.B.B..",
      "........",
      "........",
    ]);
    expect(cross[indexOf(3, 3)]).toBe(EMPTY);
    const flips = flipsFor(cross, indexOf(3, 3), BLACK);
    expect(flips).toHaveLength(8);
    expect([...flips].sort((a, b) => a - b)).toEqual(
      [
        indexOf(2, 2),
        indexOf(3, 2),
        indexOf(4, 2),
        indexOf(2, 3),
        indexOf(4, 3),
        indexOf(2, 4),
        indexOf(3, 4),
        indexOf(4, 4),
      ].sort((a, b) => a - b),
    );
  });

  it("翻不过去的位置不合法：己方子、空角、越界都返回空", () => {
    const board = initialBoard();

    // 已有子的格子永远不是合法手。
    expect(flipsFor(board, indexOf(3, 3), BLACK)).toEqual([]);
    expect(isLegal(board, indexOf(3, 3), BLACK)).toBe(false);

    // 空旷角落没有可夹的对手子。
    expect(flipsFor(board, indexOf(0, 0), BLACK)).toEqual([]);
    expect(isLegal(board, indexOf(0, 0), BLACK)).toBe(false);

    // 越界下标安全返回。
    expect(flipsFor(board, -1, BLACK)).toEqual([]);
    expect(flipsFor(board, CELLS, BLACK)).toEqual([]);
    expect(flipsFor(board, 1.5, BLACK)).toEqual([]);
  });

  it("线段尽头是空位时不算合法手", () => {
    // 落黑在 (4,0)：左边是两个白子，再往左是空位 —— 尽头不是己方子，翻不了。
    const dead = boardOf([
      "..WW....",
      "........",
      "........",
      "........",
      "........",
      "........",
      "........",
      "........",
    ]);
    expect(flipsFor(dead, indexOf(4, 0), BLACK)).toEqual([]);
    expect(isLegal(dead, indexOf(4, 0), BLACK)).toBe(false);
    // 同一盘里 (4,0) 对白方也不是合法手（左边紧邻白子，不是对手子）。
    expect(flipsFor(dead, indexOf(4, 0), WHITE)).toEqual([]);
  });
});

describe("applyMove", () => {
  it("返回新盘并翻转所有可翻子，原盘不动", () => {
    const board = initialBoard();
    const move = indexOf(2, 3);
    const next = applyMove(board, move, BLACK);

    expect(next).not.toBe(board);
    expect(next[move]).toBe(BLACK);
    // (3,3) 的白子被翻成黑子。
    expect(next[indexOf(3, 3)]).toBe(BLACK);
    expect(countDiscs(next)).toEqual({ black: 4, white: 1, empty: 59 });
    // 原盘保持原样。
    expect(board[move]).toBe(EMPTY);
    expect(countDiscs(board)).toEqual({ black: 2, white: 2, empty: 60 });
  });

  it("非法手原样返回一份拷贝", () => {
    const board = initialBoard();
    const next = applyMove(board, indexOf(0, 0), BLACK);
    expect(next).not.toBe(board);
    expect(next).toEqual(board);
  });

  it("完整对局中每一手都真的翻子、空位每次少一格", () => {
    let board = initialBoard();
    let color: Color = BLACK;
    let moves = 0;

    while (!isGameOver(board) && moves < 200) {
      const legal = legalMoves(board, color);
      if (legal.length === 0) {
        color = opponentOf(color); // 弃手
        continue;
      }
      const pick = legal[0] as number;
      const expectedFlips = flipsFor(board, pick, color);
      const next = applyMove(board, pick, color);
      for (const index of expectedFlips) expect(next[index]).toBe(color);
      expect(countDiscs(next).empty).toBe(countDiscs(board).empty - 1);
      board = next;
      color = opponentOf(color);
      moves += 1;
    }

    // 一局必定在 60 手内结束（64 格 - 初始 4 子）。
    expect(isGameOver(board)).toBe(true);
    expect(moves).toBeLessThanOrEqual(60);
  });
});

describe("弃手与终局", () => {
  it("满盘时双方都无合法手", () => {
    const full = new Array<Disc>(CELLS).fill(BLACK);
    expect(legalMoves(full, WHITE)).toEqual([]);
    expect(legalMoves(full, BLACK)).toEqual([]);
    expect(isGameOver(full)).toBe(true);
  });

  it("只有一方无合法手时不算终局（该弃手）", () => {
    const board = lockedBoard();
    expect(legalMoves(board, WHITE)).toEqual([]);
    expect(legalMoves(board, BLACK)).toEqual([indexOf(2, 2)]);
    expect(isGameOver(board)).toBe(false);
  });

  it("双方交替到都无手时才判终局", () => {
    let board = initialBoard();
    let color: Color = BLACK;
    let passes = 0;
    let steps = 0;

    while (!isGameOver(board) && steps < 300) {
      const legal = legalMoves(board, color);
      if (legal.length === 0) {
        passes += 1;
        // 连续两次弃手就必然是终局，不会死循环。
        expect(passes).toBeLessThanOrEqual(2);
        color = opponentOf(color);
        steps += 1;
        continue;
      }
      passes = 0;
      board = applyMove(board, legal[0] as number, color);
      color = opponentOf(color);
      steps += 1;
    }

    expect(isGameOver(board)).toBe(true);
    const { black, white } = countDiscs(board);
    expect(black + white).toBeGreaterThanOrEqual(4);
  });
});

describe("AI", () => {
  it("永远只挑合法手", () => {
    let board = initialBoard();
    let color: Color = WHITE;

    for (let step = 0; step < 40; step += 1) {
      const legal = legalMoves(board, color);
      const pick = aiPick(board, color, seeded(step + 1));
      if (legal.length === 0) {
        expect(pick).toBe(-1);
        break;
      }
      expect(legal).toContain(pick);
      expect(isLegal(board, pick, color)).toBe(true);
      board = applyMove(board, pick, color);
      color = opponentOf(color);
      if (isGameOver(board)) break;
    }
  });

  it("同一个随机种子结果完全可复现", () => {
    const board = initialBoard();
    const a = aiPick(board, WHITE, seeded(7));
    const b = aiPick(board, WHITE, seeded(7));
    expect(a).toBe(b);
    expect(a).toBeGreaterThanOrEqual(0);
  });

  it("无合法手时返回 -1", () => {
    expect(aiPick(lockedBoard(), WHITE, seeded(1))).toBe(-1);
  });

  it("评分公式：翻转数*10 + 角 60 / 角邻 -25 + 随机 0~8", () => {
    const board = initialBoard();
    // (2,3) 是开局黑的一手：翻 1 子、不在角也不在角邻。
    const plain = aiMoveScore(board, indexOf(2, 3), BLACK, () => 0);
    expect(plain).toBe(10);
    // 随机项上界：0.999999 * 8 ≈ 8。
    const jitter = aiMoveScore(board, indexOf(2, 3), BLACK, () => 0.999999);
    expect(jitter).toBeGreaterThan(17);
    expect(jitter).toBeLessThanOrEqual(18);

    // 角：白在 (0,0) 翻 (1,0) 一子。
    const cornerBoard = boardOf([
      ".BW.....",
      "........",
      "........",
      "........",
      "........",
      "........",
      "........",
      "........",
    ]);
    expect(isLegal(cornerBoard, indexOf(0, 0), WHITE)).toBe(true);
    expect(aiMoveScore(cornerBoard, indexOf(0, 0), WHITE, () => 0)).toBe(10 + 60);

    // 角邻 (1,1)：白翻 (2,2) 一子，扣 25。
    const adjBoard = boardOf([
      "........",
      "........",
      "..B.....",
      "...W....",
      "........",
      "........",
      "........",
      "........",
    ]);
    expect(isLegal(adjBoard, indexOf(1, 1), WHITE)).toBe(true);
    expect(aiMoveScore(adjBoard, indexOf(1, 1), WHITE, () => 0)).toBe(10 - 25);
  });

  it("角位的 60 分加成让 AI 优先吃角", () => {
    const cornerBoard = boardOf([
      ".BW.....",
      "........",
      "........",
      "........",
      "........",
      "........",
      "..WB....",
      "........",
    ]);
    // 两手各翻 1 子：角 (0,0) 得 70，普通位 (4,6) 只得 10，角必然胜出。
    expect(isLegal(cornerBoard, indexOf(0, 0), WHITE)).toBe(true);
    expect(flipsFor(cornerBoard, indexOf(0, 0), WHITE)).toEqual([indexOf(1, 0)]);
    expect(isLegal(cornerBoard, indexOf(4, 6), WHITE)).toBe(true);
    expect(flipsFor(cornerBoard, indexOf(4, 6), WHITE)).toEqual([indexOf(3, 6)]);
    expect(aiPick(cornerBoard, WHITE, () => 0)).toBe(indexOf(0, 0));
  });
});

describe("计分", () => {
  it("赢 +100 再算子差", () => {
    expect(scoreRound(40, 20)).toBe(120);
    expect(scoreRound(64, 0)).toBe(164);
    expect(scoreRound(33, 31)).toBe(102);
  });

  it("平局 +30，输棋 0 分但照样算子差", () => {
    expect(scoreRound(32, 32)).toBe(30);
    expect(scoreRound(20, 40)).toBe(-20);
    expect(scoreRound(0, 64)).toBe(-64);
  });

  it("三局累加得到本局总分", () => {
    const rounds: readonly (readonly [number, number])[] = [
      [40, 24],
      [32, 32],
      [28, 36],
    ];
    let total = 0;
    let diff = 0;
    for (const [mine, theirs] of rounds) {
      total += scoreRound(mine, theirs);
      diff += mine - theirs;
    }
    // 116 + 30 + (-8)
    expect(total).toBe(138);
    expect(diff).toBe(8);
  });
});

describe("光标移动与拷贝", () => {
  it("四向各走一格，到边停住不越界", () => {
    const center = indexOf(3, 3);
    expect(cursorStep(center, "right")).toBe(indexOf(4, 3));
    expect(cursorStep(center, "left")).toBe(indexOf(2, 3));
    expect(cursorStep(center, "down")).toBe(indexOf(3, 4));
    expect(cursorStep(center, "up")).toBe(indexOf(3, 2));

    expect(cursorStep(indexOf(0, 0), "left")).toBe(indexOf(0, 0));
    expect(cursorStep(indexOf(0, 0), "up")).toBe(indexOf(0, 0));
    expect(cursorStep(indexOf(7, 7), "right")).toBe(indexOf(7, 7));
    expect(cursorStep(indexOf(7, 7), "down")).toBe(indexOf(7, 7));
    expect(cursorStep(center, "action")).toBe(center);
  });

  it("firstLegalCursor 落在真实合法手上", () => {
    const board = initialBoard();
    const cursor = firstLegalCursor(board, BLACK);
    expect(legalMoves(board, BLACK)).toContain(cursor);
    expect(isLegal(board, cursor, BLACK)).toBe(true);
  });

  it("cloneBoard 独立于原盘", () => {
    const board = initialBoard();
    const copy = cloneBoard(board);
    copy[0] = BLACK;
    expect(board[0]).toBe(EMPTY);
    expect(copy).toHaveLength(CELLS);
  });
});
