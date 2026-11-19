import { describe, expect, it } from "vitest";

import {
  CANNON_MAX,
  CANNON_MIN,
  CLEAR_POINTS,
  COLS_EVEN,
  COLS_ODD,
  DIAMETER,
  DROP_POINTS,
  FIELD_W,
  ORIGIN_X,
  PREFILL_ROWS,
  RADIUS,
  ROW_H,
  ROWS_MAX,
  SHOTS,
  cellColor,
  clampCannon,
  colsInRow,
  countBubbles,
  createGrid,
  detachedFromCeiling,
  hexCenter,
  hexNeighbors,
  insertBubble,
  isCleared,
  isValidCell,
  landingCell,
  lowestOccupiedRow,
  randomColor,
  reflectAngle,
  removeCells,
  sameColorCluster,
  scoreForClear,
  scoreForDrop,
  snapToGrid,
  substepsFor,
  swapColors,
  type Grid,
} from "../src/logic";

/** 可复现随机源：同一个种子跑出同一盘泡泡。 */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

/** 空网格：ROWS_MAX 行，每行 COLS_EVEN 长（奇数列第 8 格永远不用）。 */
function emptyGrid(): Grid {
  return Array.from({ length: ROWS_MAX }, () => new Array<number | null>(COLS_EVEN).fill(null));
}

describe("常量与蜂窝几何", () => {
  it("半径 8、行高 13.86、8/7 列、40 发", () => {
    expect(RADIUS).toBe(8);
    expect(DIAMETER).toBe(16);
    expect(ROW_H).toBeCloseTo(13.86, 5);
    expect(COLS_EVEN).toBe(8);
    expect(COLS_ODD).toBe(7);
    expect(SHOTS).toBe(40);
    expect(colsInRow(0)).toBe(COLS_EVEN);
    expect(colsInRow(1)).toBe(COLS_ODD);
    expect(colsInRow(2)).toBe(COLS_EVEN);
  });

  it("hexCenter 偶数行不偏移、奇数行整体右移半个直径", () => {
    expect(hexCenter(0, 0)).toEqual({ x: ORIGIN_X, y: 8 });
    expect(hexCenter(0, 1).x).toBeCloseTo(ORIGIN_X + RADIUS, 6);
    expect(hexCenter(3, 0).x).toBeCloseTo(ORIGIN_X + 3 * DIAMETER, 6);
    expect(hexCenter(3, 1).x).toBeCloseTo(ORIGIN_X + 3 * DIAMETER + RADIUS, 6);
    // 同一列在奇偶行之间正好差半个直径
    expect(hexCenter(2, 4).x - hexCenter(2, 5).x).toBeCloseTo(-RADIUS, 6);
  });

  it("hexCenter 行高按 13.86 累加，含首末两行", () => {
    expect(hexCenter(0, 1).y).toBeCloseTo(ROW_H + 8, 6);
    expect(hexCenter(0, ROWS_MAX - 1).y).toBeCloseTo(8 + (ROWS_MAX - 1) * ROW_H, 6);
    // 底部最后一行的泡泡不能穿到炮台上
    expect(hexCenter(0, ROWS_MAX - 1).y + RADIUS).toBeLessThan(194 - DIAMETER);
  });

  it("整块蜂窝水平居中且不越界（左右留白对称）", () => {
    const left = hexCenter(0, 0).x - RADIUS;
    const right = hexCenter(COLS_EVEN - 1, 0).x + RADIUS;
    expect(left).toBeGreaterThan(0);
    expect(right).toBeLessThanOrEqual(FIELD_W);
    expect(left).toBeCloseTo(FIELD_W - right, 6);
    // 奇数行最右列也不能顶出画布
    expect(hexCenter(COLS_ODD - 1, 1).x + RADIUS).toBeLessThanOrEqual(FIELD_W);
  });

  it("isValidCell 过滤负行、越界列与奇数行第 8 格", () => {
    expect(isValidCell(0, 0)).toBe(true);
    expect(isValidCell(COLS_ODD - 1, 1)).toBe(true);
    expect(isValidCell(COLS_ODD, 1)).toBe(false);
    expect(isValidCell(COLS_EVEN - 1, 0)).toBe(true);
    expect(isValidCell(-1, 0)).toBe(false);
    expect(isValidCell(0, -1)).toBe(false);
    expect(isValidCell(0, ROWS_MAX)).toBe(false);
    expect(isValidCell(1.5, 0)).toBe(false);
  });
});

describe("hexNeighbors · 奇偶行偏移不同", () => {
  it("偶数行内部有六个邻居，偏移如规格", () => {
    const neighbors = hexNeighbors(3, 2);
    expect(neighbors).toHaveLength(6);
    expect(neighbors).toEqual(
      expect.arrayContaining([
        { col: 2, row: 2 },
        { col: 4, row: 2 },
        { col: 3, row: 1 },
        { col: 2, row: 1 },
        { col: 3, row: 3 },
        { col: 2, row: 3 },
      ]),
    );
  });

  it("奇数行内部有六个邻居，上半行整体右移一格", () => {
    const neighbors = hexNeighbors(3, 3);
    expect(neighbors).toHaveLength(6);
    expect(neighbors).toEqual(
      expect.arrayContaining([
        { col: 2, row: 3 },
        { col: 4, row: 3 },
        { col: 4, row: 2 },
        { col: 3, row: 2 },
        { col: 4, row: 4 },
        { col: 3, row: 4 },
      ]),
    );
    // 同一个 (col,row) 换成偶数行，邻居集合必然不同
    const evenSet = hexNeighbors(3, 2).map((cell) => `${cell.col},${cell.row}`);
    const oddSet = hexNeighbors(3, 3).map((cell) => `${cell.col},${cell.row}`);
    expect(evenSet.sort()).not.toEqual(oddSet.sort());
  });

  it("顶部行不返回 row -1，左右边界列也被过滤", () => {
    expect(hexNeighbors(0, 0).every((cell) => cell.row >= 0 && cell.col >= 0)).toBe(true);
    expect(hexNeighbors(0, 0)).toHaveLength(2);
    expect(hexNeighbors(COLS_EVEN - 1, 0).every((cell) => cell.col < COLS_EVEN)).toBe(true);
    expect(hexNeighbors(COLS_EVEN - 1, 0)).toHaveLength(2);

    // 奇数行最右列 (6,1)：它的正右与斜上方都指向第 7 列。
    // 第 7 列在**偶数行是合法**的（8 列），在奇数行不存在——这正是奇偶偏移的体现。
    const oddEdge = hexNeighbors(COLS_ODD - 1, 1);
    expect(oddEdge).toHaveLength(5);
    expect(oddEdge).not.toContainEqual({ col: COLS_ODD, row: 1 });
    expect(oddEdge).toContainEqual({ col: COLS_ODD, row: 0 });
    expect(oddEdge).toContainEqual({ col: COLS_ODD, row: 2 });
    for (const cell of oddEdge) expect(isValidCell(cell.col, cell.row)).toBe(true);
  });

  it("底部最后一行的邻居全部落在网格内", () => {
    for (let col = 0; col < colsInRow(ROWS_MAX - 1); col += 1) {
      for (const cell of hexNeighbors(col, ROWS_MAX - 1)) {
        expect(cell.row).toBeLessThan(ROWS_MAX);
        expect(isValidCell(cell.col, cell.row)).toBe(true);
      }
    }
  });
});

describe("snapToGrid · 吸附到最近的格心", () => {
  it("格心吸附回自己（含奇偶行与边界行）", () => {
    for (const [col, row] of [
      [0, 0],
      [3, 0],
      [7, 0],
      [0, 1],
      [6, 1],
      [4, 5],
      [0, ROWS_MAX - 1],
      // ROWS_MAX - 1 = 10 是偶数行，第 8 列合法；换成 9（奇数行）就只有 7 列了
      [COLS_EVEN - 1, ROWS_MAX - 1],
      [COLS_ODD - 1, ROWS_MAX - 2],
    ] as const) {
      const center = hexCenter(col, row);
      expect(snapToGrid(center.x, center.y)).toEqual({ col, row });
    }
  });

  it("偏移一点也吸回同一个格心，且结果永远是合法格", () => {
    const center = hexCenter(4, 4);
    expect(snapToGrid(center.x + 3, center.y - 3)).toEqual({ col: 4, row: 4 });
    // 随机撒点，全部必须落在合法格子里
    const rng = seeded(7);
    for (let i = 0; i < 200; i += 1) {
      const cell = snapToGrid(rng() * FIELD_W, rng() * (ROWS_MAX * ROW_H));
      expect(isValidCell(cell.col, cell.row)).toBe(true);
    }
  });

  it("吸附结果就是几何最近邻（不会贴到更远的格子）", () => {
    const rng = seeded(21);
    for (let i = 0; i < 40; i += 1) {
      const x = rng() * FIELD_W;
      const y = rng() * (ROWS_MAX * ROW_H);
      const picked = snapToGrid(x, y);
      const pickedCenter = hexCenter(picked.col, picked.row);
      const pickedDist = Math.hypot(pickedCenter.x - x, pickedCenter.y - y);

      for (let row = 0; row < ROWS_MAX; row += 1) {
        for (let col = 0; col < colsInRow(row); col += 1) {
          const center = hexCenter(col, row);
          const dist = Math.hypot(center.x - x, center.y - y);
          expect(pickedDist).toBeLessThanOrEqual(dist + 1e-9);
        }
      }
    }
  });
});

describe("reflectAngle · 撞墙反弹", () => {
  it("撞左墙取反、撞右墙取反、场中央不变", () => {
    expect(reflectAngle(-50, RADIUS)).toBe(50);
    expect(reflectAngle(50, FIELD_W - RADIUS)).toBe(-50);
    expect(reflectAngle(-50, FIELD_W / 2)).toBe(-50);
    expect(reflectAngle(50, FIELD_W / 2)).toBe(50);
    // 已经在墙边但朝场内飞：不翻转
    expect(reflectAngle(50, RADIUS)).toBe(50);
    expect(reflectAngle(-50, FIELD_W - RADIUS)).toBe(-50);
  });

  it("竖直发射（vx = 0）与非法输入都稳定返回 0", () => {
    expect(reflectAngle(0, RADIUS)).toBe(0);
    expect(reflectAngle(Number.NaN, RADIUS)).toBe(0);
  });
});

describe("createGrid / randomColor", () => {
  it("预填 5 行，第 6 行起全空，奇数行只有 7 颗", () => {
    const grid = createGrid(seeded(3));
    for (let row = 0; row < PREFILL_ROWS; row += 1) {
      for (let col = 0; col < colsInRow(row); col += 1) {
        expect(cellColor(grid, col, row)).not.toBeNull();
      }
      // 每一行「最后一列之后」的那个位置永远是空的（奇数行第 8 格非法）
      expect(cellColor(grid, colsInRow(row), row)).toBeNull();
    }
    for (let row = PREFILL_ROWS; row < ROWS_MAX; row += 1) {
      for (let col = 0; col < colsInRow(row); col += 1) {
        expect(cellColor(grid, col, row)).toBeNull();
      }
    }
    expect(countBubbles(grid)).toBe(8 + 7 + 8 + 7 + 8);
    expect(lowestOccupiedRow(grid)).toBe(PREFILL_ROWS - 1);
  });

  it("同一个种子跑出同一盘，颜色都在 0..3", () => {
    const a = createGrid(seeded(99));
    const b = createGrid(seeded(99));
    expect(a).toEqual(b);
    for (let row = 0; row < ROWS_MAX; row += 1) {
      for (let col = 0; col < colsInRow(row); col += 1) {
        const color = cellColor(a, col, row);
        if (color === null) continue;
        expect(color).toBeGreaterThanOrEqual(0);
        expect(color).toBeLessThan(4);
      }
    }
  });

  it("randomColor 把 1 / NaN 夹回合法下标，0 取第一色", () => {
    expect(randomColor(() => 0)).toBe(0);
    expect(randomColor(() => 0.999999)).toBe(3);
    expect(randomColor(() => 1)).toBe(3);
    expect(randomColor(() => Number.NaN)).toBe(0);
    expect(randomColor(() => 0.5, 2)).toBe(1);
  });
});

describe("sameColorCluster", () => {
  it("只连同色，不认识异色邻居", () => {
    const grid = emptyGrid();
    insertBubble(grid, 3, 2, 1);
    insertBubble(grid, 4, 2, 1);
    insertBubble(grid, 3, 1, 1);
    insertBubble(grid, 5, 2, 2);

    const cluster = sameColorCluster(grid, 3, 2);
    expect(cluster).toHaveLength(3);
    expect(cluster).toEqual(
      expect.arrayContaining([
        { col: 3, row: 2 },
        { col: 4, row: 2 },
        { col: 3, row: 1 },
      ]),
    );
    expect(cluster).not.toContainEqual({ col: 5, row: 2 });
    // 异色那格只能连通自己
    expect(sameColorCluster(grid, 5, 2)).toEqual([{ col: 5, row: 2 }]);
  });

  it("奇数行的连通也要按奇数行偏移来算", () => {
    const grid = emptyGrid();
    // (3,3) 奇数行，上半邻居是 (3,2) 与 (4,2)
    insertBubble(grid, 3, 3, 2);
    insertBubble(grid, 4, 2, 2);
    insertBubble(grid, 2, 2, 2);

    const cluster = sameColorCluster(grid, 3, 3);
    expect(cluster).toHaveLength(2);
    expect(cluster).toEqual(
      expect.arrayContaining([
        { col: 3, row: 3 },
        { col: 4, row: 2 },
      ]),
    );
  });

  it("空格返回空数组，单颗返回自己", () => {
    const grid = emptyGrid();
    expect(sameColorCluster(grid, 2, 2)).toEqual([]);
    insertBubble(grid, 2, 2, 0);
    expect(sameColorCluster(grid, 2, 2)).toEqual([{ col: 2, row: 2 }]);
  });

  it("同色三连能凑到 3 颗，这是消除的门槛", () => {
    const grid = emptyGrid();
    insertBubble(grid, 0, 0, 3);
    insertBubble(grid, 1, 0, 3);
    insertBubble(grid, 0, 1, 3);
    expect(sameColorCluster(grid, 0, 0)).toHaveLength(3);
    expect(sameColorCluster(grid, 0, 0).length >= 3).toBe(true);
  });
});

describe("detachedFromCeiling", () => {
  it("顶部行永不掉落", () => {
    const grid = emptyGrid();
    insertBubble(grid, 5, 0, 1);
    expect(detachedFromCeiling(grid)).toEqual([]);

    // 顶部一行铺满，也不掉
    for (let col = 0; col < COLS_EVEN; col += 1) insertBubble(grid, col, 0, 0);
    expect(detachedFromCeiling(grid)).toEqual([]);
  });

  it("完全悬空的一串会被整串列出", () => {
    const grid = emptyGrid();
    insertBubble(grid, 2, 2, 1);
    insertBubble(grid, 3, 2, 2);
    expect(detachedFromCeiling(grid)).toEqual([
      { col: 2, row: 2 },
      { col: 3, row: 2 },
    ]);
  });

  it("连到顶部的那串不掉，只有断开的部分掉", () => {
    const grid = emptyGrid();
    insertBubble(grid, 0, 0, 1);
    insertBubble(grid, 0, 1, 1);
    insertBubble(grid, 0, 2, 1);
    insertBubble(grid, 6, 3, 2);

    const loose = detachedFromCeiling(grid);
    expect(loose).toEqual([{ col: 6, row: 3 }]);
    expect(loose).not.toContainEqual({ col: 0, row: 2 });
  });
});

describe("计分与炮台", () => {
  it("scoreForClear 是线性 20 × n", () => {
    expect(CLEAR_POINTS).toBe(20);
    expect(scoreForClear(3)).toBe(60);
    expect(scoreForClear(7)).toBe(140);
    expect(scoreForClear(0)).toBe(0);
    expect(scoreForClear(2) + scoreForClear(3)).toBe(scoreForClear(5));
    expect(scoreForClear(Number.NaN)).toBe(0);
  });

  it("scoreForDrop 每颗 10 分", () => {
    expect(DROP_POINTS).toBe(10);
    expect(scoreForDrop(4)).toBe(40);
    expect(scoreForDrop(0)).toBe(0);
  });

  it("clampCannon 夹在 [8, 160]", () => {
    expect(CANNON_MIN).toBe(8);
    expect(CANNON_MAX).toBe(160);
    expect(clampCannon(-40)).toBe(8);
    expect(clampCannon(999)).toBe(160);
    expect(clampCannon(84)).toBe(84);
  });

  it("substepsFor 按 4ms 拆子步，防空闲时至少 1 步", () => {
    expect(substepsFor(0)).toBe(1);
    expect(substepsFor(4)).toBe(1);
    expect(substepsFor(5)).toBe(2);
    expect(substepsFor(50)).toBe(13);
  });

  it("swapColors 互换手上与下一颗", () => {
    expect(swapColors(0, 3)).toEqual([3, 0]);
    expect(swapColors(2, 2)).toEqual([2, 2]);
  });
});

describe("landingCell · 落位到最近的空格", () => {
  it("空网格落点就是几何吸附的格子", () => {
    const grid = emptyGrid();
    const center = hexCenter(4, 3);
    expect(landingCell(grid, center.x, center.y)).toEqual({ col: 4, row: 3 });
  });

  it("落点被占用时吸附到最近的空格，且不会返回已占用的格子", () => {
    const grid = emptyGrid();
    insertBubble(grid, 4, 3, 1);

    const center = hexCenter(4, 3);
    const cell = landingCell(grid, center.x, center.y);
    expect(cell).not.toBeNull();
    expect(cellColor(grid, cell!.col, cell!.row)).toBeNull();
    expect(isValidCell(cell!.col, cell!.row)).toBe(true);

    // 必须是所有空格里离落点最近的
    const picked = hexCenter(cell!.col, cell!.row);
    const pickedDist = Math.hypot(picked.x - center.x, picked.y - center.y);
    for (let row = 0; row < ROWS_MAX; row += 1) {
      for (let col = 0; col < colsInRow(row); col += 1) {
        if (cellColor(grid, col, row) !== null) continue;
        const other = hexCenter(col, row);
        const dist = Math.hypot(other.x - center.x, other.y - center.y);
        expect(pickedDist).toBeLessThanOrEqual(dist + 1e-9);
      }
    }
  });

  it("顶部整行铺满时落位到第二行；网格全满返回 null", () => {
    const grid = emptyGrid();
    for (let col = 0; col < COLS_EVEN; col += 1) insertBubble(grid, col, 0, 0);

    const top = hexCenter(3, 0);
    const cell = landingCell(grid, top.x, top.y + DIAMETER);
    expect(cell).not.toBeNull();
    expect(cell!.row).toBe(1);

    for (let row = 0; row < ROWS_MAX; row += 1) {
      for (let col = 0; col < colsInRow(row); col += 1) insertBubble(grid, col, row, 0);
    }
    expect(landingCell(grid, top.x, top.y)).toBeNull();
  });
});

describe("网格读写与终局判定", () => {
  it("removeCells 批量清空后 countBubbles 归零", () => {
    const grid = emptyGrid();
    insertBubble(grid, 0, 0, 0);
    insertBubble(grid, 1, 0, 1);
    expect(countBubbles(grid)).toBe(2);
    expect(isCleared(grid)).toBe(false);

    removeCells(grid, [
      { col: 0, row: 0 },
      { col: 1, row: 0 },
    ]);
    expect(countBubbles(grid)).toBe(0);
    expect(isCleared(grid)).toBe(true);
    expect(lowestOccupiedRow(grid)).toBe(-1);
  });

  it("落子在非法格 / 已占用格上会被拒绝", () => {
    const grid = emptyGrid();
    expect(insertBubble(grid, COLS_ODD, 1, 2)).toBe(false);
    expect(insertBubble(grid, -1, 0, 2)).toBe(false);
    expect(insertBubble(grid, 0, ROWS_MAX, 2)).toBe(false);

    expect(insertBubble(grid, 0, 0, 2)).toBe(true);
    expect(insertBubble(grid, 0, 0, 3)).toBe(false);
    expect(cellColor(grid, 0, 0)).toBe(2);
  });

  it("颜色 0 是合法颜色，不能被当成空格", () => {
    const grid = emptyGrid();
    insertBubble(grid, 2, 2, 0);
    expect(cellColor(grid, 2, 2)).toBe(0);
    expect(countBubbles(grid)).toBe(1);
    expect(lowestOccupiedRow(grid)).toBe(2);
  });
});
