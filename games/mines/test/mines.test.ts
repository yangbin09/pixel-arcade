import { describe, expect, it } from "vitest";

import {
  CELLS,
  MINES,
  SIZE,
  createBoard,
  isWin,
  neighborsOf,
  placeMines,
  placeMinesAt,
  reveal,
  toggleFlag,
  type Board,
} from "../src/logic";

/** 可复现随机源：同一个种子跑出同一盘雷。 */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

/** 按棋盘数据重新数一遍邻雷，用来校验 counts 缓存。 */
function countAround(board: Board, index: number): number {
  let count = 0;
  for (const neighbor of neighborsOf(index)) {
    if (board.mines[neighbor]) count += 1;
  }
  return count;
}

describe("棋盘常量与邻域表", () => {
  it("8×8、10 颗雷", () => {
    expect(SIZE).toBe(8);
    expect(CELLS).toBe(64);
    expect(MINES).toBe(10);
  });

  it("角落 3 邻、边 5 邻、中心 8 邻", () => {
    expect([...neighborsOf(0)].sort((a, b) => a - b)).toEqual([1, 8, 9]);
    expect(neighborsOf(7)).toHaveLength(3);
    expect(neighborsOf(3)).toHaveLength(5);
    expect(neighborsOf(27)).toHaveLength(8);
  });
});

describe("createBoard", () => {
  it("初始未布雷、全未翻开，HUD 能直接显示 10 颗雷", () => {
    const board = createBoard();
    expect(board.mines).toHaveLength(CELLS);
    expect(board.mines.some(Boolean)).toBe(false);
    expect(board.opened.some(Boolean)).toBe(false);
    expect(board.flagged.some(Boolean)).toBe(false);
    expect(board.placed).toBe(false);
    expect(board.mineCount).toBe(MINES);
    expect(board.openedCount).toBe(0);
    expect(board.flags).toBe(0);
  });
});

describe("placeMines · 首点安全", () => {
  it("每个格子作为首点时，本格与 8 邻域都不会有雷", () => {
    for (let safeIndex = 0; safeIndex < CELLS; safeIndex += 1) {
      const board = createBoard();
      placeMines(board, safeIndex, seeded(safeIndex + 1));

      expect(board.mines.filter(Boolean)).toHaveLength(MINES);
      expect(board.placed).toBe(true);
      expect(board.mineCount).toBe(MINES);

      const zone = [safeIndex, ...neighborsOf(safeIndex)];
      for (const index of zone) expect(board.mines[index]).toBe(false);
    }
  });

  it("随机源取极端值时仍避开安全区", () => {
    for (const rng of [() => 0, () => 0.999999]) {
      const board = createBoard();
      placeMines(board, 27, rng);
      expect(board.mines.filter(Boolean)).toHaveLength(MINES);
      for (const index of [27, ...neighborsOf(27)]) expect(board.mines[index]).toBe(false);
    }
  });

  it("布雷后缓存每个格子的邻雷数", () => {
    const board = createBoard();
    placeMines(board, 0, seeded(99));

    for (let index = 0; index < CELLS; index += 1) {
      if (board.mines[index]) continue;
      expect(board.counts[index]).toBe(countAround(board, index));
    }
  });
});

describe("reveal", () => {
  it("翻数字格只开一格，并计入已开格", () => {
    const board = createBoard();
    placeMinesAt(board, [0]);

    const result = reveal(board, 9);

    expect(result.hitMine).toBe(false);
    expect(result.opened).toEqual([9]);
    expect(board.opened[9]).toBe(true);
    expect(board.openedCount).toBe(1);
    expect(reveal(board, 9).opened).toEqual([]);
    expect(board.openedCount).toBe(1);
  });

  it("插旗的格子翻不动", () => {
    const board = createBoard();
    placeMinesAt(board, [0]);
    toggleFlag(board, 9);

    expect(reveal(board, 9).opened).toEqual([]);
    expect(board.openedCount).toBe(0);
  });

  it("踩雷只报告命中，不增加已开格", () => {
    const board = createBoard();
    placeMinesAt(board, [27]);

    const result = reveal(board, 27);

    expect(result.hitMine).toBe(true);
    expect(result.opened).toEqual([]);
    expect(board.openedCount).toBe(0);
    expect(board.opened[27]).toBe(false);
  });

  it("0 邻域用 BFS 洪水填充，一次开完整片安全区", () => {
    const board = createBoard();
    placeMinesAt(board, [0]);

    const result = reveal(board, 63);

    expect(result.hitMine).toBe(false);
    expect(result.opened).toHaveLength(63);
    expect(board.openedCount).toBe(63);
    expect(board.opened[0]).toBe(false);
    expect(board.opened.every((open, index) => (index === 0 ? !open : open))).toBe(true);
    expect(isWin(board)).toBe(true);
  });

  it("洪水填充会绕过插旗的格子", () => {
    const board = createBoard();
    placeMinesAt(board, [0]);
    toggleFlag(board, 63);

    reveal(board, 62);

    expect(board.openedCount).toBe(62);
    expect(board.opened[63]).toBe(false);
    expect(isWin(board)).toBe(false);
  });

  it("邻雷数不同的格子不会被 BFS 越过", () => {
    const board = createBoard();
    placeMinesAt(board, [0, 1]);
    // 9 的邻雷数是 2，翻开后只开它自己。
    expect(reveal(board, 9).opened).toEqual([9]);
  });
});

describe("toggleFlag", () => {
  it("插旗 / 取消旗，计数跟着走", () => {
    const board = createBoard();
    placeMinesAt(board, [0]);

    expect(toggleFlag(board, 63)).toBe("on");
    expect(board.flagged[63]).toBe(true);
    expect(board.flags).toBe(1);

    expect(toggleFlag(board, 63)).toBe("off");
    expect(board.flagged[63]).toBe(false);
    expect(board.flags).toBe(0);
  });

  it("旗子总数不超过 10 面", () => {
    const board = createBoard();
    placeMinesAt(board, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);

    for (let index = 40; index < 50; index += 1) {
      expect(toggleFlag(board, index)).toBe("on");
    }
    expect(board.flags).toBe(MINES);
    expect(toggleFlag(board, 50)).toBe("blocked");
    expect(board.flags).toBe(MINES);
  });

  it("已翻开的格子不能插旗", () => {
    const board = createBoard();
    placeMinesAt(board, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    reveal(board, 63);

    expect(board.opened[63]).toBe(true);
    expect(toggleFlag(board, 63)).toBe("blocked");
  });
});

describe("isWin · 胜利判定", () => {
  it("开局未胜利，翻开全部安全格才胜利", () => {
    const board = createBoard();
    expect(isWin(board)).toBe(false);

    placeMinesAt(board, [27]);
    expect(isWin(board)).toBe(false);

    reveal(board, 0);
    expect(board.openedCount).toBe(CELLS - 1);
    expect(isWin(board)).toBe(true);
  });

  it("取消误插的旗后可以补开最后一格并通关", () => {
    const board = createBoard();
    placeMinesAt(board, [0]);
    toggleFlag(board, 63);
    reveal(board, 62);
    expect(isWin(board)).toBe(false);

    toggleFlag(board, 63);
    reveal(board, 63);
    expect(board.openedCount).toBe(63);
    expect(isWin(board)).toBe(true);
  });
});
