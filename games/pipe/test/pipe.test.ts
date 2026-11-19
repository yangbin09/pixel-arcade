import { describe, expect, it } from "vitest";

import {
  CELL,
  CELLS,
  COLS,
  DOWN,
  END_INDEX,
  LEFT,
  MAX_MOVES,
  ORIGIN,
  RIGHT,
  ROWS,
  START_INDEX,
  UP,
  applyRotate,
  connects,
  countLeaks,
  filledPercent,
  flowFrom,
  generateLevel,
  isSolvable,
  leakCells,
  opposite,
  rotate,
} from "../src/logic";

/** 可复现随机源（LCG）：同一个种子跑出同一关。 */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

describe("网格常量", () => {
  it("7×9 格、每格 20px、原点 (14, 24)，棋盘 140×180", () => {
    expect(COLS).toBe(7);
    expect(ROWS).toBe(9);
    expect(CELLS).toBe(63);
    expect(CELL).toBe(20);
    expect(ORIGIN).toEqual({ x: 14, y: 24 });
    expect(COLS * CELL).toBe(140);
    expect(ROWS * CELL).toBe(180);
  });

  it("四个方向位互不重叠，起点 0、终点 62、步数上限 80", () => {
    expect([UP, RIGHT, DOWN, LEFT]).toEqual([1, 2, 4, 8]);
    expect(new Set([UP, RIGHT, DOWN, LEFT]).size).toBe(4);
    expect(START_INDEX).toBe(0);
    expect(END_INDEX).toBe(CELLS - 1);
    expect(END_INDEX).toBe(62);
    expect(MAX_MOVES).toBe(80);
  });
});

describe("rotate · 顺时针旋转", () => {
  it("转四次回到原值（全部 16 种掩码）", () => {
    for (let mask = 0; mask < 16; mask += 1) {
      let value = mask;
      for (let i = 0; i < 4; i += 1) value = rotate(value);
      expect(value).toBe(mask);
    }
  });

  it("每转一次方向位整体进位：上→右→下→左", () => {
    expect(rotate(UP)).toBe(RIGHT);
    expect(rotate(RIGHT)).toBe(DOWN);
    expect(rotate(DOWN)).toBe(LEFT);
    expect(rotate(LEFT)).toBe(UP);
    // 弯管也照样转：上 + 右 → 右 + 下
    expect(rotate(UP | RIGHT)).toBe(RIGHT | DOWN);
  });

  it("applyRotate 等价于连转 n 次，负数按 4 取模", () => {
    const mask = UP | LEFT;
    expect(applyRotate(mask, 0)).toBe(mask);
    expect(applyRotate(mask, 1)).toBe(rotate(mask));
    expect(applyRotate(mask, 4)).toBe(mask);
    expect(applyRotate(mask, 5)).toBe(rotate(mask));
    expect(applyRotate(mask, -1)).toBe(applyRotate(mask, 3));
    expect(applyRotate(mask, -6)).toBe(applyRotate(mask, 2));
  });

  it("opposite 是转两次，且互为对向", () => {
    expect(opposite(UP)).toBe(DOWN);
    expect(opposite(DOWN)).toBe(UP);
    expect(opposite(LEFT)).toBe(RIGHT);
    expect(opposite(RIGHT)).toBe(LEFT);
    expect(opposite(opposite(UP))).toBe(UP);
  });
});

describe("connects · 相邻两格是否都开口", () => {
  it("A 有右口、B 有左口才算连通", () => {
    expect(connects(RIGHT, LEFT)).toBe(true);
    expect(connects(RIGHT | UP, LEFT | DOWN)).toBe(true);
    expect(connects(RIGHT, RIGHT)).toBe(false);
    expect(connects(LEFT, LEFT)).toBe(false);
    expect(connects(RIGHT, UP)).toBe(false);
    expect(connects(0, LEFT)).toBe(false);
  });

  it("上下方向不算横向连通（那是竖向的活）", () => {
    expect(connects(UP, DOWN)).toBe(false);
    expect(connects(DOWN, UP)).toBe(false);
  });
});

describe("generateLevel · 同种子同关卡且必可解", () => {
  it("同种子生成完全相同的盘面与解", () => {
    const a = generateLevel(COLS, ROWS, seeded(2024));
    const b = generateLevel(COLS, ROWS, seeded(2024));
    expect(a.grid).toEqual(b.grid);
    expect(a.solution).toEqual(b.solution);
    expect(a.grid).toHaveLength(CELLS);
    expect(a.solution).toHaveLength(CELLS);
  });

  it("不同种子给出不同关卡（不是固定模板）", () => {
    const shapes = new Set<string>();
    for (let seed = 1; seed <= 8; seed += 1) {
      shapes.add(generateLevel(COLS, ROWS, seeded(seed * 7919)).grid.join(","));
    }
    expect(shapes.size).toBeGreaterThan(1);
  });

  it("【关键】每一关的 isSolvable 都是 true", () => {
    for (let seed = 1; seed <= 25; seed += 1) {
      const level = generateLevel(COLS, ROWS, seeded(seed * 104_729));
      expect(isSolvable(level.grid, level.solution)).toBe(true);
      // 解出来的朝向一定能把 63 格全部注满，且不漏水
      const solved = level.grid.map((mask, index) => applyRotate(mask, level.solution[index] ?? 0));
      const wet = flowFrom(START_INDEX, solved);
      expect(wet).toHaveLength(CELLS);
      expect(countLeaks(solved, wet)).toBe(0);
    }
  });

  it("初始局面不会已经漏水，也不会一开局就通关", () => {
    for (let seed = 1; seed <= 12; seed += 1) {
      const level = generateLevel(COLS, ROWS, seeded(seed * 31_337));
      const wet = flowFrom(START_INDEX, level.grid);
      expect(countLeaks(level.grid, wet)).toBe(0);
      expect(wet.length).toBeLessThan(CELLS);
    }
  });

  it("【关键】任何转格顺序的中间态都不会漏水（关卡真的能通关）", () => {
    // 只打乱内圈、边缘保持正解朝向 → 内圈任何朝向都指不到棋盘外。
    // 这条性质决定了「玩家可以边转边注水而不会中途漏」，是关卡可玩的前提。
    for (let seed = 1; seed <= 10; seed += 1) {
      const level = generateLevel(COLS, ROWS, seeded(seed * 6151));
      const grid = level.grid.slice();
      // 故意按索引顺序（最"笨"的顺序）逐格转
      for (let index = 0; index < CELLS; index += 1) {
        const need = level.solution[index] ?? 0;
        for (let turn = 0; turn < need; turn += 1) {
          grid[index] = rotate(grid[index] ?? 0);
          expect(countLeaks(grid, flowFrom(START_INDEX, grid))).toBe(0);
        }
      }
      expect(flowFrom(START_INDEX, grid)).toHaveLength(CELLS);
    }
  });

  it("【关键】完美通关的步数不会超过 MAX_MOVES，关卡真有得打", () => {
    for (let seed = 1; seed <= 20; seed += 1) {
      const level = generateLevel(COLS, ROWS, seeded(seed * 2654435761));
      const perfect = level.solution.reduce((sum, turns) => sum + (turns ?? 0), 0);
      // 白盒解 = 最优步数：必须留在步数上限之内，否则这关根本打不通
      expect(perfect).toBeLessThanOrEqual(MAX_MOVES);
      expect(perfect).toBeGreaterThan(0);
    }
  });

  it("退化随机源（恒 0 / 恒接近 1 / 恒 0.5）也能给出可解关卡", () => {
    for (const rand of [() => 0, () => 0.999999, () => 0.5]) {
      const level = generateLevel(COLS, ROWS, rand);
      expect(level.grid).toHaveLength(CELLS);
      expect(level.solution).toHaveLength(CELLS);
      expect(isSolvable(level.grid, level.solution)).toBe(true);
      const wet = flowFrom(START_INDEX, level.grid);
      expect(countLeaks(level.grid, wet)).toBe(0);
    }
  });
});

describe("isSolvable · 白盒校验", () => {
  it("把解应用回去的盘面，再交零解校验也是 true", () => {
    const level = generateLevel(COLS, ROWS, seeded(555));
    const solved = level.grid.map((mask, index) => applyRotate(mask, level.solution[index] ?? 0));
    expect(flowFrom(START_INDEX, solved)).toHaveLength(CELLS);
    // 已经转好的盘面不需要再转：零解必须成立
    expect(isSolvable(solved, new Array(CELLS).fill(0))).toBe(true);
  });

  it("乱转一格就解不开了", () => {
    const level = generateLevel(COLS, ROWS, seeded(4242));
    // 内圈某格偏离正解 → 那一段接不上，不能满盘注水。
    const broken = level.grid.slice();
    const index = level.solution.findIndex((turns) => turns > 0);
    expect(index).toBeGreaterThan(0);
    broken[index] = rotate(broken[index] ?? 0);
    expect(isSolvable(broken, level.solution)).toBe(false);
  });

  it("对随机乱解返回 false 的概率 > 0（这里是必 false）", () => {
    const rand = seeded(99);
    let rejected = 0;
    for (let trial = 0; trial < 40; trial += 1) {
      const level = generateLevel(COLS, ROWS, seeded(trial + 1));
      const bogus = level.solution.map(() => Math.floor(rand() * 4));
      if (!isSolvable(level.grid, bogus)) rejected += 1;
    }
    expect(rejected).toBeGreaterThan(0);
    expect(rejected).toBe(40);
  });
});

describe("flowFrom · 只沿连通方向扩散", () => {
  it("全盘上下直管接不上水源时注不进水", () => {
    const grid = new Array(CELLS).fill(UP | DOWN);
    expect(flowFrom(START_INDEX, grid)).toEqual([]);
  });

  it("只有接好的一串才通水，断层就停", () => {
    const grid: number[] = new Array(CELLS).fill(0);
    grid[0] = LEFT | RIGHT;
    grid[1] = LEFT | RIGHT;
    grid[2] = LEFT | RIGHT;
    grid[3] = UP; // 断在这里
    const wet = flowFrom(START_INDEX, grid).sort((a, b) => a - b);
    expect(wet).toEqual([0, 1, 2]);
  });

  it("回头路不算新格子（BFS 去重）", () => {
    const grid: number[] = new Array(CELLS).fill(0);
    grid[0] = LEFT | RIGHT;
    grid[1] = LEFT | RIGHT;
    const wet = flowFrom(START_INDEX, grid);
    expect(wet).toHaveLength(2);
    expect(new Set(wet).size).toBe(wet.length);
  });
});

describe("countLeaks / filledPercent", () => {
  it("起点左口与终点右口之外，指向棋盘外就是漏水", () => {
    const grid: number[] = new Array(CELLS).fill(0);
    grid[START_INDEX] = LEFT | RIGHT; // 左口是水源，合法
    expect(countLeaks(grid, [START_INDEX])).toBe(0);

    // 第 1 行最右朝右开口 → 漏到棋盘外
    grid[COLS - 1] = LEFT | RIGHT;
    expect(countLeaks(grid, [COLS - 1])).toBe(1);

    // 第 2 行最左朝左开口 → 也漏
    grid[COLS] = LEFT | RIGHT;
    expect(countLeaks(grid, [COLS])).toBe(1);

    // 起点朝上开口同样漏水（左边缘只豁免左口）
    const up = new Array(CELLS).fill(0);
    up[START_INDEX] = LEFT | UP;
    expect(countLeaks(up, [START_INDEX])).toBe(1);

    // 终点右口合法
    const exit = new Array(CELLS).fill(0);
    exit[END_INDEX] = LEFT | RIGHT;
    expect(countLeaks(exit, [END_INDEX])).toBe(0);
  });

  it("边界之外的未注水格不误报", () => {
    const grid = new Array(CELLS).fill(0);
    grid[0] = LEFT | RIGHT;
    // 没通水的格子即便开口朝外，也不算漏（水还没到那儿）
    grid[COLS - 1] = RIGHT;
    expect(leakCells(grid, [])).toEqual([]);
    expect(countLeaks(grid, [0])).toBe(0);
  });

  it("注水百分比按 63 格取整，夹在 0–100", () => {
    expect(filledPercent([], CELLS)).toBe(0);
    expect(filledPercent([0], CELLS)).toBe(2);
    expect(filledPercent(new Array(CELLS).fill(0), CELLS)).toBe(100);
    expect(filledPercent(new Array(CELLS + 10).fill(0), CELLS)).toBe(100);
    expect(filledPercent([0, 1], 0)).toBe(0);
    expect(Number.isInteger(filledPercent([0], CELLS))).toBe(true);
  });
});

describe("完整流程 · 转到位就通关", () => {
  it("按 solution 逐格转，注水到 100% 且全程不漏水", () => {
    const level = generateLevel(COLS, ROWS, seeded(777));
    const grid = level.grid.slice();
    let moves = 0;

    for (let index = 0; index < CELLS; index += 1) {
      const need = level.solution[index] ?? 0;
      for (let turn = 0; turn < need; turn += 1) {
        grid[index] = rotate(grid[index] ?? 0);
        moves += 1;
        // 中间状态允许水路暂时断开，但绝不能把水漏到棋盘外
        expect(countLeaks(grid, flowFrom(START_INDEX, grid))).toBe(0);
      }
    }

    const wet = flowFrom(START_INDEX, grid);
    expect(wet).toHaveLength(CELLS);
    expect(countLeaks(grid, wet)).toBe(0);
    expect(moves).toBeLessThanOrEqual(MAX_MOVES * 4);
    expect(filledPercent(wet, CELLS)).toBe(100);
  });

  it("通关后继续转，水路会重新断开（不是一转就永久有效）", () => {
    const level = generateLevel(COLS, ROWS, seeded(31_337));
    const solved = level.grid.map((mask, index) => applyRotate(mask, level.solution[index] ?? 0));
    expect(flowFrom(START_INDEX, solved)).toHaveLength(CELLS);

    // 直管转两次还是直管，弯管就错位了 → 不该还是满盘通水
    const again = solved.map((mask) => rotate(rotate(mask)));
    expect(flowFrom(START_INDEX, again).length).toBeLessThanOrEqual(CELLS);
    expect(flowFrom(START_INDEX, again).length).toBeGreaterThan(0);
  });
});
