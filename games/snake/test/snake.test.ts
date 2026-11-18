import { describe, expect, it } from "vitest";
import {
  createSnake,
  findFreeCell,
  queueDirection,
  sameCell,
  stepSnake,
  tickMsFor,
  type Cell,
} from "../src/index";

const fruitAway = (): Cell => ({ x: 15, y: 0 });

describe("贪吃蛇 · 移动与碰撞", () => {
  it("初始蛇 3 节，头在前，位于棋盘中心向右", () => {
    const snake = createSnake();
    expect(snake).toHaveLength(3);
    expect(snake[0]).toEqual({ x: 8, y: 8 });
    expect(snake[1]).toEqual({ x: 7, y: 8 });
    expect(snake[2]).toEqual({ x: 6, y: 8 });
  });

  it("普通一步：头前进一格，尾巴让位", () => {
    const result = stepSnake(createSnake(), "right", fruitAway());
    expect(result.dead).toBe(false);
    expect(result.ate).toBe(false);
    expect(result.snake).toHaveLength(3);
    expect(result.snake[0]).toEqual({ x: 9, y: 8 });
    expect(result.snake[1]).toEqual({ x: 8, y: 8 });
    expect(result.snake[2]).toEqual({ x: 7, y: 8 });
  });

  it("吃到果实：长度 +1，尾巴保留", () => {
    const snake: Cell[] = [
      { x: 5, y: 5 },
      { x: 4, y: 5 },
      { x: 3, y: 5 },
    ];
    const result = stepSnake(snake, "right", { x: 6, y: 5 });
    expect(result.dead).toBe(false);
    expect(result.ate).toBe(true);
    expect(result.snake).toHaveLength(4);
    expect(result.snake[0]).toEqual({ x: 6, y: 5 });
    expect(result.snake[3]).toEqual({ x: 3, y: 5 });
  });

  it("撞墙判定", () => {
    const snake: Cell[] = [
      { x: 15, y: 5 },
      { x: 14, y: 5 },
      { x: 13, y: 5 },
    ];
    const result = stepSnake(snake, "right", fruitAway());
    expect(result.dead).toBe(true);
    expect(result.cause).toBe("wall");
    expect(result.snake).toHaveLength(3);
    expect(result.snake[0]).toEqual({ x: 15, y: 5 });
  });

  it("咬到自己判定", () => {
    const snake: Cell[] = [
      { x: 3, y: 3 },
      { x: 2, y: 3 },
      { x: 2, y: 2 },
      { x: 3, y: 2 },
    ];
    const result = stepSnake(snake, "left", fruitAway());
    expect(result.dead).toBe(true);
    expect(result.cause).toBe("self");
  });

  it("尾巴同时让位时，走进尾格不算撞到自己", () => {
    const snake: Cell[] = [
      { x: 3, y: 3 },
      { x: 4, y: 3 },
      { x: 4, y: 4 },
      { x: 3, y: 4 },
    ];
    const result = stepSnake(snake, "down", fruitAway());
    expect(result.dead).toBe(false);
    expect(result.snake[0]).toEqual({ x: 3, y: 4 });
    expect(result.snake[result.snake.length - 1]).toEqual({ x: 4, y: 4 });
  });

  it("sameCell 按格点比较", () => {
    expect(sameCell({ x: 2, y: 3 }, { x: 2, y: 3 })).toBe(true);
    expect(sameCell({ x: 2, y: 3 }, { x: 3, y: 2 })).toBe(false);
  });
});

describe("贪吃蛇 · 转向队列", () => {
  it("禁止 180° 掉头", () => {
    expect(queueDirection([], "right", "left")).toEqual([]);
    expect(queueDirection([], "up", "down")).toEqual([]);
  });

  it("缓存合法转向，且最多 2 个", () => {
    expect(queueDirection([], "right", "up")).toEqual(["up"]);
    expect(queueDirection(["up"], "right", "left")).toEqual(["up", "left"]);
    expect(queueDirection(["up", "left"], "right", "down")).toEqual(["up", "left"]);
  });

  it("重复方向不占队列位置，反向按队尾判断", () => {
    expect(queueDirection(["up"], "right", "up")).toEqual(["up"]);
    expect(queueDirection(["up"], "right", "down")).toEqual(["up"]);
    expect(queueDirection(["up"], "right", "right")).toEqual(["up", "right"]);
  });
});

describe("贪吃蛇 · 速度与果实", () => {
  it("每 5 颗提速 8ms，最低 70ms", () => {
    expect(tickMsFor(0)).toBe(150);
    expect(tickMsFor(4)).toBe(150);
    expect(tickMsFor(5)).toBe(142);
    expect(tickMsFor(10)).toBe(134);
    expect(tickMsFor(50)).toBe(70);
    expect(tickMsFor(1000)).toBe(70);
  });

  it("果实只落在空格", () => {
    const snake = createSnake();
    for (let i = 0; i < 32; i += 1) {
      const cell = findFreeCell(snake, () => i / 32);
      expect(cell).not.toBeNull();
      if (!cell) continue;
      expect(snake.some((part) => sameCell(part, cell))).toBe(false);
    }
  });

  it("随机取格覆盖整个空闲区域；棋盘满了返回 null", () => {
    const snake: Cell[] = [{ x: 0, y: 0 }];
    expect(findFreeCell(snake, () => 0)).toEqual({ x: 1, y: 0 });
    expect(findFreeCell(snake, () => 0.999999)).toEqual({ x: 15, y: 15 });

    const full: Cell[] = [];
    for (let y = 0; y < 16; y += 1) {
      for (let x = 0; x < 16; x += 1) full.push({ x, y });
    }
    expect(findFreeCell(full)).toBeNull();
  });
});
