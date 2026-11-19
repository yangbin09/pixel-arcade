import { describe, expect, it } from "vitest";

import {
  CELLS,
  LEVELS,
  SIZE,
  START_CURSOR,
  cloneBoard,
  createBoard,
  cursorStep,
  isSolved,
  litCount,
  neighborsOf,
  scramble,
  scrambleSteps,
  toggle,
  type Board,
} from "../src/logic";

/** 可复现随机源：同一个种子跑出同一盘灯。 */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

const indexPath = (row: number, col: number): number => row * SIZE + col;

/** 按打散路径「反序」回放：因为有解的定义就是这条路径的逆。 */
function replayReverse(board: Board, path: readonly number[]): Board {
  const out = cloneBoard(board);
  for (let i = path.length - 1; i >= 0; i -= 1) toggle(out, path[i] as number);
  return out;
}

describe("棋盘常量与翻转邻域", () => {
  it("5×5 共 25 盏灯、共 5 关", () => {
    expect(SIZE).toBe(5);
    expect(CELLS).toBe(25);
    expect(LEVELS).toBe(5);
  });

  it("角 3 邻、边 4 邻、中心 5 邻（都含自身）", () => {
    expect(neighborsOf(indexPath(0, 0))).toHaveLength(3);
    expect(neighborsOf(indexPath(0, 4))).toHaveLength(3);
    expect(neighborsOf(indexPath(4, 0))).toHaveLength(3);
    expect(neighborsOf(indexPath(4, 4))).toHaveLength(3);
    expect(neighborsOf(indexPath(0, 2))).toHaveLength(4);
    expect(neighborsOf(indexPath(2, 0))).toHaveLength(4);
    expect(neighborsOf(indexPath(4, 2))).toHaveLength(4);
    expect(neighborsOf(indexPath(2, 2))).toHaveLength(5);
  });

  it("邻域表按「自身 + 上下左右」精确展开", () => {
    const center = [...neighborsOf(indexPath(2, 2))].sort((a, b) => a - b);
    expect(center).toEqual(
      [indexPath(1, 2), indexPath(2, 1), indexPath(2, 2), indexPath(2, 3), indexPath(3, 2)].sort(
        (a, b) => a - b,
      ),
    );

    const corner = [...neighborsOf(indexPath(0, 0))].sort((a, b) => a - b);
    expect(corner).toEqual([indexPath(0, 0), indexPath(0, 1), indexPath(1, 0)].sort((a, b) => a - b));
  });
});

describe("createBoard / isSolved", () => {
  it("初始盘面全灭，直接算通关", () => {
    const board = createBoard();
    expect(board).toHaveLength(CELLS);
    expect(board.some(Boolean)).toBe(false);
    expect(litCount(board)).toBe(0);
    expect(isSolved(board)).toBe(true);
  });

  it("isSolved 只认全灭：亮一盏就不算", () => {
    const board = createBoard();
    board[0] = true;
    expect(isSolved(board)).toBe(false);
    expect(litCount(board)).toBe(1);

    board[0] = false;
    expect(isSolved(board)).toBe(true);
  });
});

describe("toggle", () => {
  it("翻转两次复原", () => {
    const board = createBoard();
    const before = cloneBoard(board);

    toggle(board, indexPath(2, 2));
    toggle(board, indexPath(2, 2));

    expect(board).toEqual(before);
    expect(isSolved(board)).toBe(true);
  });

  it("点中心翻转 5 盏，点角落翻转 3 盏", () => {
    const center = createBoard();
    toggle(center, indexPath(2, 2));
    expect(litCount(center)).toBe(5);
    expect(center[indexPath(2, 2)]).toBe(true);
    expect(center[indexPath(1, 2)]).toBe(true);
    expect(center[indexPath(3, 2)]).toBe(true);
    expect(center[indexPath(2, 1)]).toBe(true);
    expect(center[indexPath(2, 3)]).toBe(true);

    const corner = createBoard();
    toggle(corner, indexPath(0, 0));
    expect(litCount(corner)).toBe(3);
    expect(corner[indexPath(0, 0)]).toBe(true);
    expect(corner[indexPath(0, 1)]).toBe(true);
    expect(corner[indexPath(1, 0)]).toBe(true);
    expect(corner[indexPath(1, 1)]).toBe(false);
  });

  it("点边角不会翻到棋盘外", () => {
    const board = createBoard();
    toggle(board, indexPath(0, 0));
    expect(litCount(board)).toBe(3);
    expect(board).toHaveLength(CELLS);
    expect(board.filter(Boolean)).toHaveLength(3);

    const edge = createBoard();
    toggle(edge, indexPath(0, 2));
    expect(litCount(edge)).toBe(4);
  });

  it("越界的序号直接忽略", () => {
    const board = createBoard();
    toggle(board, -1);
    toggle(board, CELLS);
    toggle(board, 999);
    expect(isSolved(board)).toBe(true);
  });
});

describe("scrambleSteps · 打散步数", () => {
  it("第 1 关 3 步起，之后每关 +2（3 + (level-1)*2）", () => {
    expect(scrambleSteps(1)).toBe(3);
    expect(scrambleSteps(2)).toBe(5);
    expect(scrambleSteps(3)).toBe(7);
    expect(scrambleSteps(4)).toBe(9);
    expect(scrambleSteps(5)).toBe(11);
  });

  it("非法关数被夹到第 1 关", () => {
    expect(scrambleSteps(0)).toBe(3);
    expect(scrambleSteps(-3)).toBe(3);
  });
});

describe("scramble · 必定有解", () => {
  it("反序回放打散路径一定回到全灭（五关 × 多种子）", () => {
    for (let level = 1; level <= LEVELS; level += 1) {
      for (let seed = 1; seed <= 40; seed += 1) {
        const result = scramble(level, seeded(seed * 977 + level));

        // 打散出来的盘面本身不能已经是通关状态。
        expect(isSolved(result.board)).toBe(false);
        expect(result.path).toHaveLength(result.steps);
        expect(result.steps).toBe(scrambleSteps(level));

        // 关键证明：把打散路径倒过来按一遍，必定全灭。
        const solved = replayReverse(result.board, result.path);
        expect(isSolved(solved)).toBe(true);
        expect(litCount(solved)).toBe(0);
      }
    }
  });

  it("打散路径里的格子都是合法序号且互不重复", () => {
    for (let level = 1; level <= LEVELS; level += 1) {
      const result = scramble(level, seeded(level * 31));
      for (const index of result.path) {
        expect(index).toBeGreaterThanOrEqual(0);
        expect(index).toBeLessThan(CELLS);
      }
      expect(new Set(result.path).size).toBe(result.path.length);
    }
  });

  it("同一个种子出同一盘灯，不同种子会不同", () => {
    const a = scramble(3, seeded(7));
    const b = scramble(3, seeded(7));
    expect(b.board).toEqual(a.board);
    expect(b.path).toEqual(a.path);

    const boards = new Set<string>();
    for (let seed = 1; seed <= 20; seed += 1) {
      boards.add(scramble(3, seeded(seed)).board.map((v) => (v ? "1" : "0")).join(""));
    }
    expect(boards.size).toBeGreaterThan(1);
  });

  it("极端随机源下也能生成非空且可解的关卡", () => {
    for (const rng of [() => 0, () => 0.999999, () => 1]) {
      for (let level = 1; level <= LEVELS; level += 1) {
        const result = scramble(level, rng);
        expect(isSolved(result.board)).toBe(false);
        expect(isSolved(replayReverse(result.board, result.path))).toBe(true);
      }
    }
  });
});

describe("cursorStep · 光标移动", () => {
  it("上下左右各走一格", () => {
    const center = indexPath(2, 2);
    expect(cursorStep(center, "up")).toBe(indexPath(1, 2));
    expect(cursorStep(center, "down")).toBe(indexPath(3, 2));
    expect(cursorStep(center, "left")).toBe(indexPath(2, 1));
    expect(cursorStep(center, "right")).toBe(indexPath(2, 3));
  });

  it("到边就停住，不越界也不环绕", () => {
    expect(cursorStep(indexPath(0, 0), "up")).toBe(indexPath(0, 0));
    expect(cursorStep(indexPath(0, 0), "left")).toBe(indexPath(0, 0));
    expect(cursorStep(indexPath(0, 4), "right")).toBe(indexPath(0, 4));
    expect(cursorStep(indexPath(0, 4), "up")).toBe(indexPath(0, 4));
    expect(cursorStep(indexPath(4, 4), "down")).toBe(indexPath(4, 4));

    // 从最左往右一步不会跳行。
    expect(cursorStep(indexPath(1, 4), "right")).toBe(indexPath(1, 4));
  });

  it("任意起点连续走 200 步都留在棋盘内", () => {
    const actions = ["up", "down", "left", "right"];
    for (let start = 0; start < CELLS; start += 1) {
      let index = start;
      for (let step = 0; step < 200; step += 1) {
        index = cursorStep(index, actions[step % actions.length] as string);
        expect(index).toBeGreaterThanOrEqual(0);
        expect(index).toBeLessThan(CELLS);
      }
    }
  });

  it("非方向动作不移动光标", () => {
    const center = indexPath(2, 2);
    expect(cursorStep(center, "action")).toBe(center);
    expect(cursorStep(center, "primary")).toBe(center);
    expect(cursorStep(center, "pause")).toBe(center);
  });

  it("默认光标在棋盘正中", () => {
    expect(START_CURSOR).toBe(indexPath(2, 2));
  });
});

describe("整局流程模拟", () => {
  it("五关按反序路径解开，总步数 = 五关打散步数之和", () => {
    let total = 0;
    const rng = seeded(2024);

    for (let level = 1; level <= LEVELS; level += 1) {
      const result = scramble(level, rng);
      let board = result.board;
      let moves = 0;

      // 玩家用「正确解」的逆路径去点。
      for (let i = result.path.length - 1; i >= 0; i -= 1) {
        board = toggle(board, result.path[i] as number);
        moves += 1;
        expect(board).toHaveLength(CELLS);
      }

      expect(isSolved(board)).toBe(true);
      expect(moves).toBe(scrambleSteps(level));
      total += moves;
    }

    expect(total).toBe(
      scrambleSteps(1) +
        scrambleSteps(2) +
        scrambleSteps(3) +
        scrambleSteps(4) +
        scrambleSteps(5),
    );
  });
});
