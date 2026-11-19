import { describe, expect, it } from "vitest";

import {
  AI,
  BLUNDER_RATE,
  CELL,
  CELLS,
  EMPTY,
  ORIGIN,
  PLAYER,
  ROUNDS,
  SIZE,
  START_CURSOR,
  WIN_LEN,
  bestMove,
  candidateMoves,
  cellCenter,
  cellToIndex,
  checkWin,
  cursorStep,
  emptyBoard,
  indexToCell,
  isFull,
  legalMoves,
  matchDecided,
  opponentOf,
  roundPoints,
  scoreCell,
  winningLine,
} from "../src/logic";

/** 可复现随机源：同一个种子跑出同一串。 */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

/** 造一个只摆了几颗子的棋盘。 */
function boardWith(stones: readonly (readonly [number, number, number])[]): number[] {
  const board = emptyBoard();
  for (const [col, row, who] of stones) board[cellToIndex(col, row)] = who;
  return board;
}

/** 在棋盘上落一子并返回新盘（测试里不关心非法手）。 */
function place(board: number[], col: number, row: number, who: number): number[] {
  const next = board.slice();
  next[cellToIndex(col, row)] = who;
  return next;
}

/**
 * 简单贪心「人类」策略：一层打分 —— 自己的进攻分 + 0.7 倍对手威胁分。
 *
 * 它不做任何搜索、不算先后手次序，就是普通人「能连就连、该堵就堵」的水平。
 * 这个策略能赢，才说明 AI 真的可被击败（规格硬性要求 40 局至少赢 5 局）。
 */
function greedyHumanPick(board: number[], rand: () => number): number {
  const moves = candidateMoves(board);
  const list = moves.length > 0 ? moves : legalMoves(board);
  if (list.length === 0) return -1;

  const scores = list.map(
    (index) => scoreCell(board, index, PLAYER) + scoreCell(board, index, AI) * 0.7,
  );
  const best = Math.max(...scores);
  const ties = list.filter((_, i) => best - (scores[i] as number) <= 1);
  const pick = ties[Math.floor(rand() * ties.length)] ?? list[0];
  return pick as number;
}

/** 跑一整局：玩家先手，双方都用给定的选点函数，返回赢家。 */
function playRound(
  humanRand: () => number,
  aiRand: () => number,
  aiFirst = false,
): { winner: number; moves: number } {
  let board = emptyBoard();
  let turn = aiFirst ? AI : PLAYER;
  let moves = 0;

  for (;;) {
    if (isFull(board)) return { winner: 0, moves };

    const index = turn === PLAYER ? greedyHumanPick(board, humanRand) : bestMove(board, AI, aiRand);
    if (index < 0) return { winner: 0, moves };

    board[index] = turn;
    moves += 1;
    const winner = checkWin(board, index);
    if (winner !== 0) return { winner, moves };
    turn = opponentOf(turn);
  }
}

describe("棋盘常量与几何", () => {
  it("13×13、12px 格子、原点 (6,6)、连五即胜", () => {
    expect(SIZE).toBe(13);
    expect(CELLS).toBe(169);
    expect(CELL).toBe(12);
    expect(ORIGIN).toBe(6);
    expect(WIN_LEN).toBe(5);
    expect(ROUNDS).toBe(3);
  });

  it("cellCenter 落在格心上：6 + col*12 + 6", () => {
    expect(cellCenter(0, 0)).toEqual({ x: 12, y: 12 });
    expect(cellCenter(1, 0)).toEqual({ x: 24, y: 12 });
    expect(cellCenter(0, 1)).toEqual({ x: 12, y: 24 });
    expect(cellCenter(12, 12)).toEqual({ x: 156, y: 156 });
  });

  it("indexToCell 与 cellToIndex 互逆（全盘 169 格）", () => {
    for (let index = 0; index < CELLS; index += 1) {
      const { col, row } = indexToCell(index);
      expect(col).toBeGreaterThanOrEqual(0);
      expect(col).toBeLessThan(SIZE);
      expect(row).toBeGreaterThanOrEqual(0);
      expect(row).toBeLessThan(SIZE);
      expect(cellToIndex(col, row)).toBe(index);
    }
    // 抽查几处具体坐标
    expect(indexToCell(0)).toEqual({ col: 0, row: 0 });
    expect(indexToCell(12)).toEqual({ col: 12, row: 0 });
    expect(indexToCell(13)).toEqual({ col: 0, row: 1 });
    expect(indexToCell(168)).toEqual({ col: 12, row: 12 });
  });

  it("越界下标安全返回 (-1,-1)，不会抛错", () => {
    expect(indexToCell(-1)).toEqual({ col: -1, row: -1 });
    expect(indexToCell(CELLS)).toEqual({ col: -1, row: -1 });
    expect(indexToCell(1.5)).toEqual({ col: -1, row: -1 });
  });

  it("emptyBoard 是 169 个空格，且每次返回新数组", () => {
    const board = emptyBoard();
    expect(board).toHaveLength(CELLS);
    expect(board.every((value) => value === EMPTY)).toBe(true);

    board[0] = PLAYER;
    expect(emptyBoard()[0]).toBe(EMPTY);
  });
});

describe("legalMoves", () => {
  it("空盘返回全部 169 个点", () => {
    expect(legalMoves(emptyBoard())).toHaveLength(CELLS);
  });

  it("排除已占点，保留下标升序", () => {
    const board = boardWith([
      [0, 0, PLAYER],
      [6, 6, AI],
      [12, 12, PLAYER],
    ]);
    const moves = legalMoves(board);

    expect(moves).toHaveLength(CELLS - 3);
    expect(moves).not.toContain(cellToIndex(0, 0));
    expect(moves).not.toContain(cellToIndex(6, 6));
    expect(moves).not.toContain(cellToIndex(12, 12));
    for (let i = 1; i < moves.length; i += 1) {
      expect(moves[i] as number).toBeGreaterThan(moves[i - 1] as number);
    }
  });
});

describe("checkWin · 四种方向的连五", () => {
  it("横向五连判黑胜", () => {
    const board = boardWith([
      [3, 6, PLAYER],
      [4, 6, PLAYER],
      [5, 6, PLAYER],
      [6, 6, PLAYER],
      [7, 6, PLAYER],
    ]);
    expect(checkWin(board, cellToIndex(5, 6))).toBe(PLAYER);
    expect(checkWin(board, cellToIndex(3, 6))).toBe(PLAYER);
    expect(checkWin(board, cellToIndex(7, 6))).toBe(PLAYER);
  });

  it("纵向五连判白胜", () => {
    const board = boardWith([
      [6, 2, AI],
      [6, 3, AI],
      [6, 4, AI],
      [6, 5, AI],
      [6, 6, AI],
    ]);
    expect(checkWin(board, cellToIndex(6, 4))).toBe(AI);
    expect(checkWin(board, cellToIndex(6, 2))).toBe(AI);
  });

  it("正斜（↘）五连", () => {
    const board = boardWith([
      [2, 2, PLAYER],
      [3, 3, PLAYER],
      [4, 4, PLAYER],
      [5, 5, PLAYER],
      [6, 6, PLAYER],
    ]);
    expect(checkWin(board, cellToIndex(4, 4))).toBe(PLAYER);
  });

  it("反斜（↗）五连", () => {
    const board = boardWith([
      [8, 2, AI],
      [7, 3, AI],
      [6, 4, AI],
      [5, 5, AI],
      [4, 6, AI],
    ]);
    expect(checkWin(board, cellToIndex(6, 4))).toBe(AI);
  });

  it("四子不算胜，第五子落下才成立", () => {
    const four = boardWith([
      [3, 6, PLAYER],
      [4, 6, PLAYER],
      [5, 6, PLAYER],
      [6, 6, PLAYER],
    ]);
    expect(checkWin(four, cellToIndex(3, 6))).toBe(0);
    expect(checkWin(four, cellToIndex(6, 6))).toBe(0);

    const five = place(four, 7, 6, PLAYER);
    expect(checkWin(five, cellToIndex(7, 6))).toBe(PLAYER);
  });

  it("被对手断开的子不算连五", () => {
    const board = boardWith([
      [3, 6, PLAYER],
      [4, 6, PLAYER],
      [5, 6, AI],
      [6, 6, PLAYER],
      [7, 6, PLAYER],
    ]);
    expect(checkWin(board, cellToIndex(4, 6))).toBe(0);
    expect(checkWin(board, cellToIndex(7, 6))).toBe(0);
  });

  it("空点与非法下标都返回 0", () => {
    const board = boardWith([[3, 6, PLAYER]]);
    expect(checkWin(board, cellToIndex(6, 6))).toBe(0);
    expect(checkWin(board, -1)).toBe(0);
    expect(checkWin(board, CELLS)).toBe(0);
  });
});

describe("winningLine", () => {
  it("横五连返回整段 5 个下标，顺序沿线排列", () => {
    const board = boardWith([
      [3, 6, PLAYER],
      [4, 6, PLAYER],
      [5, 6, PLAYER],
      [6, 6, PLAYER],
      [7, 6, PLAYER],
    ]);
    const line = winningLine(board, cellToIndex(5, 6));
    expect(line).toEqual([3, 4, 5, 6, 7].map((col) => cellToIndex(col, 6)));
  });

  it("没有连五时返回空数组", () => {
    const board = boardWith([[3, 6, PLAYER], [4, 6, PLAYER]]);
    expect(winningLine(board, cellToIndex(3, 6))).toEqual([]);
    expect(winningLine(board, cellToIndex(9, 9))).toEqual([]);
  });
});

describe("scoreCell · 评分函数", () => {
  it("已占点与非法点都是 0 分", () => {
    const board = boardWith([[6, 6, PLAYER]]);
    expect(scoreCell(board, cellToIndex(6, 6), PLAYER)).toBe(0);
    expect(scoreCell(board, -1, PLAYER)).toBe(0);
    expect(scoreCell(board, CELLS, PLAYER)).toBe(0);
  });

  it("连子越多分越高（同一条线上的空点）", () => {
    const two = boardWith([
      [4, 6, PLAYER],
      [5, 6, PLAYER],
    ]);
    const three = boardWith([
      [4, 6, PLAYER],
      [5, 6, PLAYER],
      [6, 6, PLAYER],
    ]);
    const four = boardWith([
      [4, 6, PLAYER],
      [5, 6, PLAYER],
      [6, 6, PLAYER],
      [7, 6, PLAYER],
    ]);

    const atTwo = scoreCell(two, cellToIndex(6, 6), PLAYER);
    const atThree = scoreCell(three, cellToIndex(7, 6), PLAYER);
    const atFour = scoreCell(four, cellToIndex(8, 6), PLAYER);

    expect(atTwo).toBeGreaterThan(0);
    expect(atThree).toBeGreaterThan(atTwo);
    expect(atFour).toBeGreaterThan(atThree);
  });

  it("能连五的点给出满分，普通点远小于它", () => {
    const four = boardWith([
      [4, 6, PLAYER],
      [5, 6, PLAYER],
      [6, 6, PLAYER],
      [7, 6, PLAYER],
    ]);
    const winning = scoreCell(four, cellToIndex(8, 6), PLAYER);
    const quiet = scoreCell(four, cellToIndex(2, 2), PLAYER);

    expect(winning).toBeGreaterThanOrEqual(1_000_000);
    expect(quiet).toBeLessThan(winning);
  });

  it("两侧都被堵死的连子拿不到活棋的分", () => {
    const open = boardWith([
      [5, 6, PLAYER],
      [6, 6, PLAYER],
    ]);
    const blocked = boardWith([
      [5, 6, PLAYER],
      [6, 6, PLAYER],
      [7, 6, AI],
      [4, 6, AI],
    ]);

    // 两侧堵死时，落在 (3,6)/(8,6) 只能接一头，分数应明显低于活棋。
    const openScore = scoreCell(open, cellToIndex(7, 6), PLAYER);
    const nearBlocked = scoreCell(blocked, cellToIndex(3, 6), PLAYER);
    expect(openScore).toBeGreaterThan(nearBlocked);
  });
});

describe("candidateMoves · 候选窗口", () => {
  it("空盘落在天元", () => {
    expect(candidateMoves(emptyBoard())).toEqual([cellToIndex(6, 6)]);
  });

  it("只返回已有棋子周围 2 格内的空点", () => {
    const board = boardWith([[6, 6, PLAYER]]);
    const moves = candidateMoves(board);

    expect(moves.length).toBeGreaterThan(0);
    expect(moves).not.toContain(cellToIndex(6, 6));
    for (const index of moves) {
      const { col, row } = indexToCell(index);
      expect(Math.abs(col - 6)).toBeLessThanOrEqual(2);
      expect(Math.abs(row - 6)).toBeLessThanOrEqual(2);
    }
    // 5×5 方形窗口去掉中心那颗 = 24 个空点
    expect(moves).toHaveLength(24);
  });

  it("边缘棋子的窗口被裁到盘内，不会越界", () => {
    const board = boardWith([[0, 0, PLAYER]]);
    const moves = candidateMoves(board);
    expect(moves).toHaveLength(8); // (0..2) × (0..2) 去掉 (0,0)
    for (const index of moves) {
      expect(index).toBeGreaterThanOrEqual(0);
      expect(index).toBeLessThan(CELLS);
    }
  });
});

describe("bestMove · 必胜与必堵", () => {
  it("自己四连时直接连五取胜", () => {
    const board = boardWith([
      [4, 6, PLAYER],
      [5, 6, AI],
      [6, 6, PLAYER],
      [7, 6, AI],
      [8, 6, PLAYER],
      [9, 6, PLAYER],
      [10, 6, AI],
      // AI 有自己的三连，但玩家这边是活四，AI 必须先连五 —— 这里让 AI 也四连
      [6, 7, AI],
      [7, 7, AI],
      [8, 7, AI],
      [9, 7, AI],
    ]);

    // AI 有活四 (5,7)/(10,7)，应当直接连五赢，而不是去堵玩家。
    const move = bestMove(board, AI, seeded(1));
    board[move] = AI;
    expect(checkWin(board, move)).toBe(AI);
  });

  it("对手下一步能连五时必须堵住", () => {
    // 玩家四连 (4,6)..(7,6)，只有 (3,6) 和 (8,6) 两个连五点；
    // 堵完一端玩家还有另一端，所以这里造一个只剩唯一连五点的局面。
    const board = boardWith([
      [4, 6, PLAYER],
      [5, 6, PLAYER],
      [6, 6, PLAYER],
      [7, 6, PLAYER],
      [3, 6, AI], // 一端已被堵
      [6, 8, AI],
      [7, 8, AI],
      [8, 8, AI], // AI 的三连，但不是活四也连不了五
      [4, 9, AI],
    ]);

    const move = bestMove(board, AI, seeded(7));
    expect(move).toBe(cellToIndex(8, 6));
  });

  it("对手活三时优先去堵（AI 会堵活三）", () => {
    // 玩家 (5,6)(6,6)(7,6) 活三，两端 (4,6)/(8,6) 都能成活四；
    // AI 自己在远处只有一颗子，没有更好的进攻点。
    const board = boardWith([
      [5, 6, PLAYER],
      [6, 6, PLAYER],
      [7, 6, PLAYER],
      [6, 9, AI],
    ]);

    const move = bestMove(board, AI, seeded(17));
    const { col, row } = indexToCell(move);
    // 必须落在活三的某一端（堵住一端），不能跑去别处下自己的棋。
    expect(row).toBe(6);
    expect([4, 8]).toContain(col);
  });

  it("优先自己连五，而不是先堵对手（能赢就赢）", () => {
    const board = boardWith([
      // AI 四连 → 下一手连五
      [2, 2, AI],
      [3, 2, AI],
      [4, 2, AI],
      [5, 2, AI],
      // 玩家也四连 → 也威胁连五
      [2, 9, PLAYER],
      [3, 9, PLAYER],
      [4, 9, PLAYER],
      [5, 9, PLAYER],
    ]);

    const move = bestMove(board, AI, seeded(3));
    board[move] = AI;
    expect(checkWin(board, move)).toBe(AI);
  });

  it("返回的一定是空点，且不修改传入的棋盘", () => {
    const board = boardWith([
      [6, 6, PLAYER],
      [7, 7, AI],
    ]);
    const snapshot = board.slice();

    const move = bestMove(board, AI, seeded(11));
    expect(board).toEqual(snapshot);
    expect(board[move]).toBe(EMPTY);
  });

  it("空盘时落在天元附近，不越界", () => {
    const board = emptyBoard();
    const move = bestMove(board, AI, seeded(5));
    expect(move).toBe(cellToIndex(6, 6));
  });

  it("满盘时返回 -1（没有可下的点）", () => {
    const board = new Array<number>(CELLS).fill(PLAYER);
    expect(bestMove(board, AI, seeded(1))).toBe(-1);
    expect(legalMoves(board)).toHaveLength(0);
  });
});

describe("bestMove · AI 必须可被击败", () => {
  it("固定种子的贪心人类跑 40 局，至少赢 5 局", () => {
    let humanWins = 0;
    let aiWins = 0;
    let draws = 0;

    for (let round = 0; round < 40; round += 1) {
      const humanRand = seeded(1000 + round * 2);
      const aiRand = seeded(2000 + round * 2);
      const result = playRound(humanRand, aiRand);

      if (result.winner === PLAYER) humanWins += 1;
      else if (result.winner === AI) aiWins += 1;
      else draws += 1;
    }

    // 规格硬性要求：人类至少赢 5 局。AI 全胜就说明评分函数过强，必须调弱。
    expect(humanWins).toBeGreaterThanOrEqual(5);
    expect(humanWins + aiWins + draws).toBe(40);
    expect(aiWins).toBeLessThan(40);
  });

  it("失误率是可调旋钮，且落在 (0,1) 之间", () => {
    expect(BLUNDER_RATE).toBeGreaterThan(0);
    expect(BLUNDER_RATE).toBeLessThan(1);
  });
});

describe("光标与三局两胜计分", () => {
  it("cursorStep 四向各走一格，到边停住", () => {
    const center = cellToIndex(6, 6);
    expect(cursorStep(center, "left")).toBe(cellToIndex(5, 6));
    expect(cursorStep(center, "right")).toBe(cellToIndex(7, 6));
    expect(cursorStep(center, "up")).toBe(cellToIndex(6, 5));
    expect(cursorStep(center, "down")).toBe(cellToIndex(6, 7));

    expect(indexToCell(cursorStep(cellToIndex(0, 0), "left"))).toEqual({ col: 0, row: 0 });
    expect(indexToCell(cursorStep(cellToIndex(0, 0), "up"))).toEqual({ col: 0, row: 0 });
    const corner = cellToIndex(12, 12);
    expect(indexToCell(cursorStep(corner, "right"))).toEqual({ col: 12, row: 12 });
    expect(indexToCell(cursorStep(corner, "down"))).toEqual({ col: 12, row: 12 });
  });

  it("cursorStep 遇到非方向动作或非法下标时保持安全位置", () => {
    const index = cellToIndex(6, 6);
    expect(cursorStep(index, "action")).toBe(index);
    expect(cursorStep(-5, "left")).toBe(cursorStep(START_CURSOR, "left"));
    expect(cursorStep(9999, "up")).toBe(cursorStep(START_CURSOR, "up"));
  });

  it("roundPoints：赢局计分、零封额外奖励、输平不得分", () => {
    expect(roundPoints(0, 0)).toBe(0);
    expect(roundPoints(0, 2)).toBe(0);
    expect(roundPoints(1, 1)).toBe(500);
    // 2:0 零封 = 2×500 + 200
    expect(roundPoints(2, 0)).toBe(1200);
    // 2:1 没有零封奖励
    expect(roundPoints(2, 1)).toBe(1000);
    // 单调：胜得越多分越高
    expect(roundPoints(2, 0)).toBeGreaterThan(roundPoints(1, 1));
  });

  it("matchDecided：任一方先到两胜才结束", () => {
    expect(matchDecided(0, 0)).toBe(false);
    expect(matchDecided(1, 1)).toBe(false);
    expect(matchDecided(2, 0)).toBe(true);
    expect(matchDecided(0, 2)).toBe(true);
  });

  it("isFull 与满盘平局判定", () => {
    expect(isFull(emptyBoard())).toBe(false);
    expect(isFull(new Array<number>(CELLS).fill(PLAYER))).toBe(true);

    const almost = new Array<number>(CELLS).fill(PLAYER);
    almost[CELLS - 1] = EMPTY;
    expect(isFull(almost)).toBe(false);
  });
});
