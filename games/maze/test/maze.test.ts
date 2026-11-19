import { describe, expect, it } from "vitest";

import {
  CELL,
  COLS,
  DIRS,
  EXIT,
  EXIT_INDEX,
  KEYS,
  ORIGIN,
  ROWS,
  START,
  START_INDEX,
  VIEW_RADIUS,
  canWalk,
  cellCenter,
  cellToIndex,
  dirFromAction,
  exploredPercent,
  generateMaze,
  indexToCell,
  isWall,
  neighbor,
  placeKeys,
  reachable,
  visibleCells,
  walkableIndices,
} from "../src/logic";

/** 可复现随机源：同一个种子生成同一座迷宫。 */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

/** 两座迷宫逐格比对。 */
function sameMaze(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return false;
  return true;
}

/** 用一次生成结果跑完整流程，供多条用例复用。 */
const maze = generateMaze(COLS, ROWS, seeded(2024));

describe("常量与坐标换算", () => {
  it("13×15 格、12px、原点 6/15、视野 3 格、3 把钥匙", () => {
    expect(COLS).toBe(13);
    expect(ROWS).toBe(15);
    expect(CELL).toBe(12);
    expect(ORIGIN.x).toBe(6);
    // 规格同时要求「156×180」与「垂直居中」：210 高时只能居中在 y=15
    expect(ORIGIN.y).toBe((210 - ROWS * CELL) / 2);
    expect(VIEW_RADIUS).toBe(3);
    expect(KEYS).toBe(3);
  });

  it("cellToIndex / indexToCell 互为逆运算", () => {
    for (let row = 0; row < ROWS; row += 1) {
      for (let col = 0; col < COLS; col += 1) {
        const index = cellToIndex(col, row);
        expect(indexToCell(index)).toEqual({ col, row });
      }
    }
    expect(cellToIndex(EXIT.col, EXIT.row)).toBe(EXIT_INDEX);
  });

  it("cellCenter 落在格心且不出棋盘", () => {
    const center = cellCenter(START_INDEX);
    expect(center.x).toBe(ORIGIN.x + 1 * CELL + CELL / 2);
    expect(center.y).toBe(ORIGIN.y + 1 * CELL + CELL / 2);
    const far = cellCenter(EXIT_INDEX);
    expect(far.x).toBeLessThan(ORIGIN.x + COLS * CELL);
    expect(far.y).toBeLessThan(ORIGIN.y + ROWS * CELL);
  });
});

describe("generateMaze · 同种子同迷宫", () => {
  it("同一个种子生成完全一样的迷宫", () => {
    const a = generateMaze(COLS, ROWS, seeded(7));
    const b = generateMaze(COLS, ROWS, seeded(7));
    expect(sameMaze(a, b)).toBe(true);
  });

  it("不同种子给出不同迷宫", () => {
    const a = generateMaze(COLS, ROWS, seeded(11));
    const b = generateMaze(COLS, ROWS, seeded(12));
    expect(sameMaze(a, b)).toBe(false);
  });

  it("起点固定左上 (1,1) 是走廊，右下出口也是走廊", () => {
    const board = generateMaze(COLS, ROWS, seeded(3));
    expect(board[START_INDEX]).toBe(0);
    expect(board[EXIT_INDEX]).toBe(0);
    expect(isWall(board, START.col, START.row)).toBe(false);
    expect(isWall(board, EXIT.col, EXIT.row)).toBe(false);
  });

  it("外墙全是墙，内部格子数符合奇偶规则", () => {
    const board = generateMaze(COLS, ROWS, seeded(5));
    for (let col = 0; col < COLS; col += 1) {
      expect(board[cellToIndex(col, 0)]).toBe(1);
      expect(board[cellToIndex(col, ROWS - 1)]).toBe(1);
    }
    for (let row = 0; row < ROWS; row += 1) {
      expect(board[cellToIndex(0, row)]).toBe(1);
      expect(board[cellToIndex(COLS - 1, row)]).toBe(1);
    }
    // 奇数列 1..11（6 列）× 奇数行 1..13（7 行）= 42 个生成树节点；
    // 每条树边再挖通一格中间的墙，共 42 + 41 = 83 个走廊格。
    expect(walkableIndices(board)).toHaveLength(42 * 2 - 1);
  });
});

describe("可达性 · 起点到出口必须连通", () => {
  it("起点到出口 BFS 可达（多个种子都验一遍）", () => {
    for (let seed = 1; seed <= 20; seed += 1) {
      const board = generateMaze(COLS, ROWS, seeded(seed));
      expect(reachable(board, START_INDEX, EXIT_INDEX)).toBe(true);
    }
  });

  it("每个走廊格都在起点所在的连通块里（生成树必然连通）", () => {
    const board = generateMaze(COLS, ROWS, seeded(77));
    for (const index of walkableIndices(board)) {
      expect(reachable(board, START_INDEX, index)).toBe(true);
    }
  });

  it("墙格与越界不算可达", () => {
    const board = generateMaze(COLS, ROWS, seeded(9));
    expect(reachable(board, START_INDEX, 0)).toBe(false);
    expect(reachable(board, START_INDEX, -1)).toBe(false);
    expect(reachable(board, START_INDEX, COLS * ROWS)).toBe(false);
  });
});

describe("isWall / canWalk / neighbor", () => {
  it("越界一律算墙", () => {
    expect(isWall(maze, -1, 1)).toBe(true);
    expect(isWall(maze, 1, -1)).toBe(true);
    expect(isWall(maze, COLS, 1)).toBe(true);
    expect(isWall(maze, 1, ROWS)).toBe(true);
    expect(isWall(maze, START.col, START.row)).toBe(false);
  });

  it("canWalk 拒绝斜走与穿墙，接受相邻走廊", () => {
    expect(canWalk(maze, { col: 1, row: 1 }, { col: 2, row: 2 })).toBe(false);
    expect(canWalk(maze, { col: 1, row: 1 }, { col: 1, row: 1 })).toBe(false);
    expect(canWalk(maze, { col: 0, row: 1 }, { col: 1, row: 1 })).toBe(false);
    const open = DIRS.map((dir) => neighbor(maze, START_INDEX, dir)).filter((i) => i >= 0);
    expect(open.length).toBeGreaterThan(0);
    for (const index of open) {
      expect(canWalk(maze, { col: START.col, row: START.row }, indexToCell(index))).toBe(true);
    }
  });

  it("neighbor 撞墙返回 -1，走廊返回正确下标", () => {
    expect(neighbor(maze, START_INDEX, "up")).toBe(-1);
    expect(neighbor(maze, START_INDEX, "left")).toBe(-1);
    for (const dir of DIRS) {
      const next = neighbor(maze, START_INDEX, dir);
      if (next < 0) continue;
      expect(indexToCell(next)).toEqual({
        col: START.col + (dir === "left" ? -1 : dir === "right" ? 1 : 0),
        row: START.row + (dir === "up" ? -1 : dir === "down" ? 1 : 0),
      });
    }
  });
});

describe("visibleCells · 迷雾视野", () => {
  it("永远包含自身，且不超出半径 3 格", () => {
    const seen = visibleCells(maze, START);
    expect(seen).toContain(START_INDEX);
    for (const index of seen) {
      const { col, row } = indexToCell(index);
      expect(Math.max(Math.abs(col - START.col), Math.abs(row - START.row))).toBeLessThanOrEqual(
        VIEW_RADIUS,
      );
    }
  });

  it("不穿墙：每个可见格都是走廊", () => {
    const seen = visibleCells(maze, { col: 5, row: 7 });
    for (const index of seen) {
      expect(maze[index]).toBe(0);
    }
  });

  it("站在墙里看不见任何东西", () => {
    expect(visibleCells(maze, { col: 0, row: 0 })).toEqual([]);
  });

  it("同一位置的两次调用结果一致，且无重复项", () => {
    const a = visibleCells(maze, START);
    const b = visibleCells(maze, START);
    expect(a).toEqual(b);
    expect(new Set(a).size).toBe(a.length);
  });
});

describe("placeKeys", () => {
  it("同种子同钥匙位，且不会落在起点或出口", () => {
    const a = placeKeys(maze, seeded(42), KEYS);
    const b = placeKeys(maze, seeded(42), KEYS);
    expect(a).toEqual(b);
    expect(a).toHaveLength(KEYS);
    expect(a).not.toContain(START_INDEX);
    expect(a).not.toContain(EXIT_INDEX);
  });

  it("钥匙都落在走廊格上，且互不重叠", () => {
    const keys = placeKeys(maze, seeded(8), KEYS);
    expect(new Set(keys).size).toBe(keys.length);
    for (const index of keys) expect(maze[index]).toBe(0);
  });

  it("钥匙一定可达（否则无法通关）", () => {
    for (let seed = 1; seed <= 10; seed += 1) {
      const board = generateMaze(COLS, ROWS, seeded(seed));
      for (const index of placeKeys(board, seeded(seed + 100), KEYS)) {
        expect(reachable(board, START_INDEX, index)).toBe(true);
      }
    }
  });
});

describe("exploredPercent", () => {
  it("空集是 0，全探索是 100", () => {
    const walkable = walkableIndices(maze);
    expect(exploredPercent(new Set(), walkable)).toBe(0);
    expect(exploredPercent(new Set(walkable), walkable)).toBe(100);
    expect(exploredPercent(new Set(), walkable.length)).toBe(0);
    expect(exploredPercent(new Set(walkable), walkable.length)).toBe(100);
  });

  it("一半探索约等于 50，且始终夹在 0..100", () => {
    const walkable = walkableIndices(maze);
    const half = new Set(walkable.slice(0, Math.floor(walkable.length / 2)));
    const percent = exploredPercent(half, walkable);
    expect(percent).toBeGreaterThanOrEqual(45);
    expect(percent).toBeLessThanOrEqual(55);
    expect(exploredPercent(new Set([1, 2, 3]), 0)).toBe(0);
    expect(exploredPercent(new Set([9999]), walkable)).toBeLessThanOrEqual(100);
  });
});

describe("dirFromAction", () => {
  it("四个方向可识别，其他动作返回 null", () => {
    expect(dirFromAction("up")).toBe("up");
    expect(dirFromAction("down")).toBe("down");
    expect(dirFromAction("left")).toBe("left");
    expect(dirFromAction("right")).toBe("right");
    expect(dirFromAction("primary")).toBeNull();
    expect(dirFromAction("action")).toBeNull();
  });
});
