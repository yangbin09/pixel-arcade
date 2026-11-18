import { describe, expect, it } from "vitest";

import {
  COLS,
  KIND_BY_ID,
  KIND_ID,
  PIECE_KINDS,
  ROWS,
  SHAPES,
  clearRows,
  collidesAt,
  dropDistance,
  emptyBoard,
  fullRows,
  gravityFor,
  levelFor,
  lineScore,
  makePiece,
  moved,
  pieceHeight,
  pieceWidth,
  rotateShape,
  rotated,
  shuffledBag,
  spawnX,
  stamp,
  type Board,
  type Piece,
} from "../src/logic";

/** 用 [x, y, id] 三元组铺一个测试棋盘。 */
const boardOf = (cells: [number, number, number][]): Board => {
  const board = emptyBoard();
  for (const [x, y, id] of cells) board[y * COLS + x] = id;
  return board;
};

/** 固定种子，7-bag 的测试可复现。 */
const makeRng = (): (() => number) => {
  let seed = 7;
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
};

describe("棋盘与方块", () => {
  it("棋盘是 10×20", () => {
    expect(COLS).toBe(10);
    expect(ROWS).toBe(20);
    expect(emptyBoard()).toHaveLength(COLS * ROWS);
  });

  it("7 种方块各有 4 个旋转态，每态 4 格且不重叠", () => {
    expect(PIECE_KINDS).toHaveLength(7);
    for (const kind of PIECE_KINDS) {
      expect(SHAPES[kind]).toHaveLength(4);
      for (const shape of SHAPES[kind]) {
        expect(shape).toHaveLength(4);
        const unique = new Set(shape.map(([x, y]) => `${x},${y}`));
        expect(unique.size).toBe(4);
        for (const [x, y] of shape) {
          expect(x).toBeGreaterThanOrEqual(0);
          expect(y).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });

  it("旋转公式 (x,y)->(y,-x) 并归一化", () => {
    // T 的 0 号态朝上：第二行是横条
    expect(SHAPES.T[0]).toEqual([
      [1, 0],
      [0, 1],
      [1, 1],
      [2, 1],
    ]);
    // 顺时针转一次后变成朝左的竖条，y 从 0 开始
    expect(SHAPES.T[1]).toEqual([
      [0, 1],
      [1, 2],
      [1, 1],
      [1, 0],
    ]);
    expect(rotateShape([[1, 0], [2, 0]])).toEqual([
      [0, 1],
      [0, 0],
    ]);
  });

  it("O 转四次形状不变，I 只有两种朝向", () => {
    const shapeKey = (shape: readonly (readonly [number, number])[]): string =>
      shape.map(([x, y]) => `${x},${y}`).sort().join("|");

    const o = shapeKey(SHAPES.O[0]);
    for (const shape of SHAPES.O) {
      expect(shapeKey(shape)).toBe(o);
    }

    const iStates = new Set(SHAPES.I.map((shape) => shapeKey(shape)));
    expect(iStates.size).toBe(2);
  });

  it("出生位置水平居中", () => {
    expect(spawnX("I")).toBe(3);
    expect(spawnX("O")).toBe(4);
    expect(spawnX("T")).toBe(3);

    const piece = makePiece("T");
    expect(piece).toEqual({ kind: "T", rotation: 0, x: 3, y: 0 });
    expect(collidesAt(emptyBoard(), "T", 0, 3, 0)).toBe(false);
  });

  it("宽高按包围盒计算", () => {
    expect(pieceWidth("I", 0)).toBe(4);
    expect(pieceHeight("I", 0)).toBe(1);
    expect(pieceWidth("I", 1)).toBe(1);
    expect(pieceHeight("I", 1)).toBe(4);
    expect(pieceWidth("O", 0)).toBe(2);
    expect(pieceWidth("T", 0)).toBe(3);
    expect(pieceHeight("T", 0)).toBe(2);
  });

  it("数字编码可以反查回方块", () => {
    for (const kind of PIECE_KINDS) {
      expect(KIND_BY_ID[KIND_ID[kind]]).toBe(kind);
    }
    expect(KIND_BY_ID[0]).toBeNull();
  });
});

describe("碰撞与移动", () => {
  it("墙、地板、已堆方块都会挡住", () => {
    expect(collidesAt(emptyBoard(), "T", 0, -1, 0)).toBe(true);
    expect(collidesAt(emptyBoard(), "T", 0, COLS - 2, 0)).toBe(true);
    expect(collidesAt(emptyBoard(), "O", 0, COLS - 2, 0)).toBe(false);
    expect(collidesAt(emptyBoard(), "O", 0, 0, ROWS - 2)).toBe(false);
    expect(collidesAt(emptyBoard(), "O", 0, 0, ROWS - 1)).toBe(true);

    const board = boardOf([[4, 17, 1]]);
    expect(collidesAt(board, "O", 0, 4, 16)).toBe(true);
    expect(collidesAt(board, "O", 0, 4, 15)).toBe(false);
  });

  it("左右移动成功时返回新方块，撞墙返回 null", () => {
    const piece = makePiece("T");
    const left = moved(emptyBoard(), piece, -1, 0);
    const right = moved(emptyBoard(), piece, 1, 0);
    expect(left?.x).toBe(2);
    expect(right?.x).toBe(4);
    expect(moved(emptyBoard(), { ...piece, x: 0 }, -1, 0)).toBeNull();
    expect(moved(emptyBoard(), { ...piece, x: COLS - 3 }, 1, 0)).toBeNull();
  });

  it("贴右墙旋转时向左踢 1 格", () => {
    const piece: Piece = { kind: "T", rotation: 1, x: 8, y: 0 };
    const kicked = rotated(emptyBoard(), piece);
    expect(kicked).toEqual({ kind: "T", rotation: 2, x: 7, y: 0 });
  });

  it("完全没有空间时旋转失败", () => {
    const piece: Piece = { kind: "I", rotation: 1, x: 9, y: 0 };
    // 竖 I 转成横 I 需要 4 格，左右各 1 格都不够
    expect(rotated(emptyBoard(), piece)).toBeNull();
  });

  it("硬降距离等于落到地板/堆顶的格数", () => {
    expect(dropDistance(emptyBoard(), makePiece("T"))).toBe(18);
    expect(dropDistance(emptyBoard(), makePiece("I"))).toBe(19);

    const board = boardOf([[3, 18, 1]]);
    // T 在 x=3 时最左列会压在 (3,18) 上，最多只能到 y=16
    expect(dropDistance(board, makePiece("T"))).toBe(16);
  });

  it("锁定后方块写入棋盘且不修改原棋盘", () => {
    const source = emptyBoard();
    const locked = stamp(source, { kind: "O", rotation: 0, x: 0, y: 0 });
    expect(locked[0]).toBe(KIND_ID.O);
    expect(locked[1]).toBe(KIND_ID.O);
    expect(locked[COLS]).toBe(KIND_ID.O);
    expect(locked[COLS + 1]).toBe(KIND_ID.O);
    expect(locked[2]).toBe(0);
    expect(source[0]).toBe(0);
  });
});

describe("消行", () => {
  it("识别所有填满的行", () => {
    const board = emptyBoard();
    for (let col = 0; col < COLS; col += 1) {
      board[(ROWS - 1) * COLS + col] = 1;
      board[(ROWS - 2) * COLS + col] = 1;
    }
    expect(fullRows(board)).toEqual([ROWS - 2, ROWS - 1]);

    board[(ROWS - 2) * COLS + 0] = 0;
    expect(fullRows(board)).toEqual([ROWS - 1]);
  });

  it("移除整行后上方整体下落", () => {
    const board = emptyBoard();
    for (let col = 0; col < COLS; col += 1) {
      board[(ROWS - 1) * COLS + col] = 1;
      board[(ROWS - 2) * COLS + col] = 1;
    }
    board[(ROWS - 3) * COLS + 0] = 2;

    const cleared = clearRows(board, [ROWS - 2, ROWS - 1]);
    expect(fullRows(cleared)).toEqual([]);
    expect(cleared[(ROWS - 1) * COLS + 0]).toBe(2);
    expect(cleared[ROWS * COLS - 1]).toBe(0);
  });

  it("部分填满的行不会动", () => {
    const board = boardOf([
      [0, ROWS - 1, 1],
      [1, ROWS - 1, 1],
    ]);
    const cleared = clearRows(board, []);
    expect(cleared[(ROWS - 1) * COLS + 0]).toBe(1);
    expect(cleared[(ROWS - 1) * COLS + 1]).toBe(1);
  });

  it("计分：1/2/3/4 行 = 100/300/500/800 × 等级", () => {
    expect(lineScore(0, 1)).toBe(0);
    expect(lineScore(1, 1)).toBe(100);
    expect(lineScore(2, 1)).toBe(300);
    expect(lineScore(3, 1)).toBe(500);
    expect(lineScore(4, 1)).toBe(800);
    expect(lineScore(4, 3)).toBe(2400);
  });
});

describe("等级与速度", () => {
  it("每 10 行升 1 级，封顶 99", () => {
    expect(levelFor(0)).toBe(1);
    expect(levelFor(9)).toBe(1);
    expect(levelFor(10)).toBe(2);
    expect(levelFor(19)).toBe(2);
    expect(levelFor(20)).toBe(3);
    expect(levelFor(5000)).toBe(99);
  });

  it("初始 800ms/格，每级 -60ms，最低 120ms", () => {
    expect(gravityFor(1)).toBe(800);
    expect(gravityFor(2)).toBe(740);
    expect(gravityFor(3)).toBe(680);
    expect(gravityFor(12)).toBe(140);
    expect(gravityFor(13)).toBe(120);
    expect(gravityFor(99)).toBe(120);
  });
});

describe("7-bag 随机", () => {
  it("每袋 7 个，恰好包含全部 7 种", () => {
    const bag = shuffledBag(makeRng());
    expect(bag).toHaveLength(7);
    expect(new Set(bag).size).toBe(7);
    expect([...bag].sort()).toEqual([...PIECE_KINDS].sort());
  });

  it("连续两袋都各自完整", () => {
    const rng = makeRng();
    const two = [...shuffledBag(rng), ...shuffledBag(rng)];
    expect(new Set(two.slice(0, 7)).size).toBe(7);
    expect(new Set(two.slice(7)).size).toBe(7);
  });

  it("使用固定的 0 随机源也能洗出完整一袋", () => {
    const bag = shuffledBag(() => 0);
    expect(new Set(bag).size).toBe(7);
  });
});
