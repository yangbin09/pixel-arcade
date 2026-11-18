import { describe, expect, it } from "vitest";

import {
  SIZE,
  canMove,
  emptyGrid,
  maxTile,
  slide,
  spawnTile,
  type Grid,
} from "../src/logic";

/** 把测试用字面量复制成独立棋盘，避免被意外修改。 */
const board = (rows: number[][]): Grid => rows.map((row) => [...row]);

describe("slide · 滑动合并", () => {
  it("4×4 常量是 4", () => {
    expect(SIZE).toBe(4);
  });

  it("向左压紧并合并同值，得分累加", () => {
    const input = board([
      [0, 2, 0, 2],
      [2, 2, 4, 4],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ]);

    const result = slide(input, "left");

    expect(result.moved).toBe(true);
    expect(result.grid[0]).toEqual([4, 0, 0, 0]);
    expect(result.grid[1]).toEqual([4, 8, 0, 0]);
    expect(result.gained).toBe(16);
    expect(result.merges).toEqual([
      { row: 0, col: 0, value: 4 },
      { row: 1, col: 0, value: 4 },
      { row: 1, col: 1, value: 8 },
    ]);
  });

  it("一行里的同值只合并一次", () => {
    const result = slide(
      board([
        [2, 2, 2, 2],
        [0, 0, 0, 0],
        [0, 0, 0, 0],
        [0, 0, 0, 0],
      ]),
      "left",
    );

    expect(result.grid[0]).toEqual([4, 4, 0, 0]);
    expect(result.gained).toBe(8);
    expect(result.merges).toHaveLength(2);
  });

  it("合并出的新值不会在同一次滑动里再次合并", () => {
    const result = slide(
      board([
        [2, 2, 4, 0],
        [0, 0, 0, 0],
        [0, 0, 0, 0],
        [0, 0, 0, 0],
      ]),
      "left",
    );

    expect(result.grid[0]).toEqual([4, 4, 0, 0]);
    expect(result.gained).toBe(4);
  });

  it("三个同值向左得到 4 和 2", () => {
    const result = slide(
      board([
        [2, 2, 2, 0],
        [0, 0, 0, 0],
        [0, 0, 0, 0],
        [0, 0, 0, 0],
      ]),
      "left",
    );

    expect(result.grid[0]).toEqual([4, 2, 0, 0]);
    expect(result.gained).toBe(4);
  });

  it("向右合并时保持从右到左的顺序", () => {
    const result = slide(
      board([
        [2, 2, 4, 0],
        [0, 0, 0, 0],
        [0, 0, 0, 0],
        [0, 0, 0, 0],
      ]),
      "right",
    );

    expect(result.grid[0]).toEqual([0, 0, 4, 4]);
    expect(result.gained).toBe(4);
    expect(result.merges).toEqual([{ row: 0, col: 2, value: 4 }]);
  });

  it("向上合并整列", () => {
    const result = slide(
      board([
        [2, 2, 0, 0],
        [2, 2, 0, 0],
        [4, 4, 0, 0],
        [0, 0, 0, 0],
      ]),
      "up",
    );

    expect(result.grid[0]).toEqual([4, 4, 0, 0]);
    expect(result.grid[1]).toEqual([4, 4, 0, 0]);
    expect(result.grid[2]).toEqual([0, 0, 0, 0]);
    expect(result.gained).toBe(8);
    expect(result.merges).toHaveLength(2);
  });

  it("向下合并整列", () => {
    const result = slide(
      board([
        [2, 2, 0, 0],
        [2, 2, 0, 0],
        [4, 4, 0, 0],
        [0, 0, 0, 0],
      ]),
      "down",
    );

    expect(result.grid[0]).toEqual([0, 0, 0, 0]);
    expect(result.grid[1]).toEqual([0, 0, 0, 0]);
    expect(result.grid[2]).toEqual([4, 4, 0, 0]);
    expect(result.grid[3]).toEqual([4, 4, 0, 0]);
    expect(result.gained).toBe(8);
  });

  it("一次滑动可以触发多次合并并累计得分", () => {
    const result = slide(
      board([
        [2, 2, 4, 4],
        [8, 8, 16, 16],
        [0, 0, 0, 0],
        [0, 0, 0, 0],
      ]),
      "left",
    );

    expect(result.grid[0]).toEqual([4, 8, 0, 0]);
    expect(result.grid[1]).toEqual([16, 32, 0, 0]);
    expect(result.gained).toBe(4 + 8 + 16 + 32);
  });

  it("没有变化时 moved=false", () => {
    const input = board([
      [2, 4, 8, 16],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ]);

    const result = slide(input, "left");

    expect(result.moved).toBe(false);
    expect(result.gained).toBe(0);
    expect(result.grid).toEqual(input);
  });

  it("空棋盘滑不动", () => {
    const result = slide(emptyGrid(), "up");

    expect(result.moved).toBe(false);
    expect(result.slides).toHaveLength(0);
    expect(result.merges).toHaveLength(0);
  });

  it("滑动不会修改传入的棋盘", () => {
    const input = board([
      [2, 2, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ]);
    const snapshot = board(input);

    slide(input, "left");
    slide(input, "up");

    expect(input).toEqual(snapshot);
  });

  it("为动画记录每个块从哪走到哪", () => {
    const result = slide(
      board([
        [0, 2, 0, 0],
        [0, 0, 0, 0],
        [0, 0, 0, 0],
        [0, 0, 0, 0],
      ]),
      "left",
    );

    expect(result.slides).toEqual([
      { fromRow: 0, fromCol: 1, toRow: 0, toCol: 0, value: 2 },
    ]);
  });

  it("合并的两个块都滑向同一个目标", () => {
    const result = slide(
      board([
        [2, 0, 2, 0],
        [0, 0, 0, 0],
        [0, 0, 0, 0],
        [0, 0, 0, 0],
      ]),
      "left",
    );

    expect(result.slides).toEqual([
      { fromRow: 0, fromCol: 0, toRow: 0, toCol: 0, value: 2 },
      { fromRow: 0, fromCol: 2, toRow: 0, toCol: 0, value: 2 },
    ]);
  });
});

describe("canMove · 是否还有路可走", () => {
  it("有空位就可以继续", () => {
    expect(canMove(emptyGrid())).toBe(true);
  });

  it("满盘但相邻有同值可以继续", () => {
    const grid = board([
      [2, 2, 4, 8],
      [4, 8, 16, 32],
      [8, 16, 32, 64],
      [16, 32, 64, 128],
    ]);

    expect(canMove(grid)).toBe(true);
  });

  it("满盘且横纵都没有同值时结束", () => {
    const grid = board([
      [2, 4, 2, 4],
      [4, 2, 4, 2],
      [2, 4, 2, 4],
      [4, 2, 4, 2],
    ]);

    expect(canMove(grid)).toBe(false);
  });
});

describe("maxTile · 最大方块", () => {
  it("空棋盘为 0", () => {
    expect(maxTile(emptyGrid())).toBe(0);
  });

  it("找出棋盘上最大的数字", () => {
    const grid = board([
      [2, 4, 8, 16],
      [32, 64, 128, 256],
      [512, 1024, 2048, 4],
      [0, 0, 0, 0],
    ]);

    expect(maxTile(grid)).toBe(2048);
  });
});

describe("spawnTile · 生成新块", () => {
  it("90% 生成 2，10% 生成 4", () => {
    const grid = board([
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ]);

    const two = spawnTile(grid, () => 0);
    expect(two.spawn?.value).toBe(2);

    let call = 0;
    const rng = (): number => {
      call += 1;
      return call === 1 ? 0 : 0.95;
    };
    const four = spawnTile(grid, rng);
    expect(four.spawn?.value).toBe(4);
  });

  it("0.9 的边界按 4 处理", () => {
    const grid = board([
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ]);

    let call = 0;
    const rng = (): number => {
      call += 1;
      return call === 1 ? 0 : 0.9;
    };

    expect(spawnTile(grid, rng).spawn?.value).toBe(4);
  });

  it("在空格里落子且不修改原棋盘", () => {
    const grid = board([
      [2, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ]);

    const result = spawnTile(grid, () => 0);

    expect(result.spawn).toEqual({ row: 0, col: 1, value: 2 });
    expect(result.grid[0]?.[1]).toBe(2);
    expect(grid[0]?.[1]).toBe(0);
  });

  it("满盘时不生成新块", () => {
    const grid = board([
      [2, 4, 2, 4],
      [4, 2, 4, 2],
      [2, 4, 2, 4],
      [4, 2, 4, 2],
    ]);

    const result = spawnTile(grid, () => 0);

    expect(result.spawn).toBeNull();
    expect(result.grid).toEqual(grid);
  });
});
