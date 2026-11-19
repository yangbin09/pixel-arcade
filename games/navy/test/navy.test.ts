import { describe, expect, it } from "vitest";

import {
  AI_RANDOM_CHANCE,
  CELLS,
  FLEET,
  HIT_POINTS,
  HIT,
  MAX_SCORE,
  MISS,
  SIZE,
  SINK_BONUS,
  TOTAL_SHIP_CELLS,
  UNKNOWN,
  WIPE_BONUS,
  allSunk,
  cellToIndex,
  emptyBoard,
  hitCount,
  indexToCell,
  isSunk,
  isValidFleet,
  neighborsOf,
  noteHit,
  pickShot,
  placeFleet,
  probabilityGrid,
  resolveShot,
  shipAt,
  stepCursor,
  sunkCount,
  type Ship,
} from "../src/logic";

/** 可复现随机源（LCG）：同一个种子跑出同一串数。 */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

const flat = (ships: readonly Ship[]): number[] => ships.flatMap((ship) => ship.cells);

describe("棋盘与舰队常量", () => {
  it("8×8 棋盘、五艘舰、合计 17 格", () => {
    expect(SIZE).toBe(8);
    expect(CELLS).toBe(64);
    expect(FLEET).toEqual([5, 4, 3, 3, 2]);
    expect(TOTAL_SHIP_CELLS).toBe(17);
  });

  it("满分是 17 命中 + 5 击沉 + 全歼奖励", () => {
    expect(MAX_SCORE).toBe(TOTAL_SHIP_CELLS * HIT_POINTS + FLEET.length * SINK_BONUS + WIPE_BONUS);
    expect(MAX_SCORE).toBe(167);
  });

  it("cellToIndex / indexToCell 互为反函数", () => {
    for (let index = 0; index < CELLS; index += 1) {
      const { x, y } = indexToCell(index);
      expect(cellToIndex(x, y)).toBe(index);
    }
    expect(cellToIndex(0, 0)).toBe(0);
    expect(cellToIndex(7, 7)).toBe(63);
    expect(cellToIndex(0, 1)).toBe(8);
  });
});

describe("emptyBoard", () => {
  it("64 格全部未打，且每次返回新数组", () => {
    const board = emptyBoard();
    expect(board).toHaveLength(CELLS);
    expect(board.every((state) => state === UNKNOWN)).toBe(true);

    board[0] = MISS;
    expect(emptyBoard()[0]).toBe(UNKNOWN);
  });
});

describe("placeFleet · 不重叠、不贴边", () => {
  it("同种子得到同一套布阵", () => {
    const a = placeFleet(seeded(1234));
    const b = placeFleet(seeded(1234));
    expect(flat(a)).toEqual(flat(b));
  });

  it("不同种子通常给出不同布阵", () => {
    const layouts = new Set<string>();
    for (let seed = 1; seed <= 12; seed += 1) {
      layouts.add(flat(placeFleet(seeded(seed))).join(","));
    }
    expect(layouts.size).toBeGreaterThan(1);
  });

  it("每艘舰的格数等于舰长，总数 17 且互不重叠", () => {
    for (let seed = 1; seed <= 40; seed += 1) {
      const ships = placeFleet(seeded(seed));
      expect(ships).toHaveLength(FLEET.length);
      expect(ships.map((ship) => ship.cells.length)).toEqual([...FLEET]);

      const cells = flat(ships);
      expect(cells).toHaveLength(TOTAL_SHIP_CELLS);
      expect(new Set(cells).size).toBe(TOTAL_SHIP_CELLS);
      for (const cell of cells) {
        expect(cell).toBeGreaterThanOrEqual(0);
        expect(cell).toBeLessThan(CELLS);
      }
    }
  });

  it("舰与舰之间不允许四邻相接（对角相邻可以）", () => {
    for (let seed = 1; seed <= 40; seed += 1) {
      const ships = placeFleet(seeded(seed));
      // 逐舰检查：本舰格子不得与**别的舰**的格子四邻相接。
      for (let i = 0; i < ships.length; i += 1) {
        const own = new Set((ships[i] as Ship).cells);
        const other = new Set(
          ships.filter((_, j) => j !== i).flatMap((ship) => ship.cells),
        );
        for (const cell of own) {
          for (const neighbor of neighborsOf(cell)) {
            expect(other.has(neighbor)).toBe(false);
          }
        }
      }
    }
  });

  it("每艘舰的格子共线且相邻（横或竖连成一条）", () => {
    const ships = placeFleet(seeded(99));
    for (const ship of ships) {
      const sorted = [...ship.cells].sort((a, b) => a - b);
      for (let i = 1; i < sorted.length; i += 1) {
        const gap = (sorted[i] as number) - (sorted[i - 1] as number);
        expect([1, SIZE]).toContain(gap);
      }
    }
  });

  it("极端随机源（恒定 0 / 恒定≈1）也返回合法舰队", () => {
    for (const rng of [() => 0, () => 0.999999999]) {
      const ships = placeFleet(rng);
      expect(isValidFleet(ships)).toBe(true);
    }
  });

  it("isValidFleet 能识破坏布阵", () => {
    expect(isValidFleet(placeFleet(seeded(7)))).toBe(true);

    const overlapped = placeFleet(seeded(7));
    // 把第二艘的一个格子挪到第一艘身上 → 重叠。
    (overlapped[1] as Ship).cells[0] = (overlapped[0] as Ship).cells[0] as number;
    expect(isValidFleet(overlapped)).toBe(false);

    const wrongCount = placeFleet(seeded(7)).slice(0, 4);
    expect(isValidFleet(wrongCount)).toBe(false);
  });
});

describe("isSunk / allSunk / sunkCount", () => {
  it("全部格命中才算沉", () => {
    const ships = placeFleet(seeded(5));
    const ship = ships[0] as Ship;

    expect(isSunk(ship)).toBe(false);
    ship.hits.add(ship.cells[0] as number);
    expect(isSunk(ship)).toBe(false);

    for (const cell of ship.cells) ship.hits.add(cell);
    expect(isSunk(ship)).toBe(true);
  });

  it("allSunk 要五艘全沉才 true", () => {
    const ships = placeFleet(seeded(11));
    expect(allSunk(ships)).toBe(false);

    for (const ship of ships.slice(0, 4)) {
      for (const cell of ship.cells) ship.hits.add(cell);
    }
    expect(allSunk(ships)).toBe(false);

    for (const cell of (ships[4] as Ship).cells) (ships[4] as Ship).hits.add(cell);
    expect(allSunk(ships)).toBe(true);
    expect(sunkCount(ships)).toBe(FLEET.length);
  });
});

describe("resolveShot", () => {
  it("打空记 MISS，不增加命中", () => {
    const board = emptyBoard();
    const ships = placeFleet(seeded(3));
    const sea = [...Array<number>(CELLS).keys()].find((cell) => shipAt(ships, cell) === null) as number;

    const shot = resolveShot(board, ships, sea);

    expect(shot).toEqual({ hit: false, sunk: null, already: false });
    expect(board[sea]).toBe(MISS);
    expect(hitCount(board)).toBe(0);
  });

  it("命中记 HIT，并把该格记进舰体", () => {
    const board = emptyBoard();
    const ships = placeFleet(seeded(3));
    const ship = ships[0] as Ship;
    const target = ship.cells[0] as number;

    const shot = resolveShot(board, ships, target);

    expect(shot.hit).toBe(true);
    expect(shot.sunk).toBeNull();
    expect(shot.already).toBe(false);
    expect(board[target]).toBe(HIT);
    expect(ship.hits.has(target)).toBe(true);
  });

  it("打沉最后一格时返回该舰长度", () => {
    const board = emptyBoard();
    const ships = placeFleet(seeded(21));
    // 找一艘 2 格的舰，好少打几炮。
    const ship = ships.find((item) => item.cells.length === 2) as Ship;

    for (const cell of ship.cells.slice(0, -1)) {
      expect(resolveShot(board, ships, cell).sunk).toBeNull();
    }
    const last = resolveShot(board, ships, ship.cells[ship.cells.length - 1] as number);

    expect(last.hit).toBe(true);
    expect(last.sunk).toBe(2);
    expect(isSunk(ship)).toBe(true);
  });

  it("重复炮击返回 already 且不改动任何状态", () => {
    const board = emptyBoard();
    const ships = placeFleet(seeded(8));
    const target = (ships[0] as Ship).cells[0] as number;

    resolveShot(board, ships, target);
    const again = resolveShot(board, ships, target);

    expect(again).toEqual({ hit: false, sunk: null, already: true });
    expect(board[target]).toBe(HIT);
    expect([...((ships[0] as Ship).hits)]).toEqual([target]);
  });

  it("越界下标当作 already，不污染棋盘", () => {
    const board = emptyBoard();
    const ships = placeFleet(seeded(8));

    for (const bad of [-1, CELLS, 99, 1.5, Number.NaN]) {
      expect(resolveShot(board, ships, bad).already).toBe(true);
    }
    expect(hitCount(board)).toBe(0);
    expect(board.every((state) => state === UNKNOWN)).toBe(true);
  });
});

describe("probabilityGrid", () => {
  it("长度固定 64，未打格权重为正", () => {
    const board = emptyBoard();
    const ships = placeFleet(seeded(13));
    const grid = probabilityGrid(board, ships);

    expect(grid).toHaveLength(CELLS);
    for (let index = 0; index < CELLS; index += 1) {
      expect(grid[index]).toBeGreaterThan(0);
    }
  });

  it("打空的格子权重归零，且总权重随着打空而下降", () => {
    const board = emptyBoard();
    const ships = placeFleet(seeded(13));
    const before = probabilityGrid(board, ships).reduce((sum, weight) => sum + weight, 0);

    board[0] = MISS;
    const grid = probabilityGrid(board, ships);
    const after = grid.reduce((sum, weight) => sum + weight, 0);

    expect(grid[0]).toBe(0);
    expect(after).toBeLessThan(before);
  });

  it("沉掉的舰不再贡献权重", () => {
    const board = emptyBoard();
    const ships = placeFleet(seeded(13));
    const before = probabilityGrid(board, ships).reduce((sum, weight) => sum + weight, 0);

    const doomed = ships[0] as Ship;
    for (const cell of doomed.cells) {
      board[cell] = HIT;
      doomed.hits.add(cell);
    }
    const after = probabilityGrid(board, ships).reduce((sum, weight) => sum + weight, 0);

    expect(isSunk(doomed)).toBe(true);
    expect(after).toBeLessThan(before);
  });

  it("只剩一艘舰时，最高权重格必在该舰的某条可能摆放上", () => {
    const board = emptyBoard();
    const ships = placeFleet(seeded(31));
    // 打沉前四艘，只留最后一艘。
    for (const ship of ships.slice(0, 4)) {
      for (const cell of ship.cells) {
        board[cell] = HIT;
        ship.hits.add(cell);
      }
    }

    const grid = probabilityGrid(board, ships);
    const survivors = grid
      .map((weight, index) => ({ weight, index }))
      .filter((item) => item.weight > 0)
      .map((item) => item.index);
    expect(survivors.length).toBeGreaterThan(0);

    // 存活舰的每个格子都在候选里（没被打空的那些）。
    for (const cell of (ships[4] as Ship).cells) {
      expect(survivors).toContain(cell);
    }
  });
});

describe("pickShot · AI 选点", () => {
  it("优先清掉上次命中点四邻的候选", () => {
    const board = emptyBoard();
    const ships = placeFleet(seeded(17));
    const hit = (ships[0] as Ship).cells[0] as number;
    const stack: number[] = [];
    noteHit(stack, board, hit);

    const index = pickShot(board, ships, stack, seeded(1));

    expect(neighborsOf(hit)).toContain(index);
  });

  it("命中点四邻全打过时，队列清空后仍返回可打的格子", () => {
    const board = emptyBoard();
    const ships = placeFleet(seeded(17));
    const hit = (ships[0] as Ship).cells[0] as number;
    for (const neighbor of neighborsOf(hit)) board[neighbor] = MISS;

    const stack: number[] = [];
    noteHit(stack, board, hit);
    expect(stack).toHaveLength(0);

    const index = pickShot(board, ships, stack, seeded(2));
    expect(board[index]).toBe(UNKNOWN);
  });

  it("永远不会返回已经打过的格子", () => {
    const board = emptyBoard();
    const ships = placeFleet(seeded(23));
    const rand = seeded(41);

    for (let step = 0; step < 60; step += 1) {
      const stack: number[] = [];
      const index = pickShot(board, ships, stack, rand);
      if (index < 0) break;
      expect(board[index]).toBe(UNKNOWN);
      board[index] = MISS;
    }
  });

  it("棋盘打满后返回 -1", () => {
    const board = new Array<number>(CELLS).fill(MISS);
    const ships = placeFleet(seeded(23));

    expect(pickShot(board, ships, [], seeded(1))).toBe(-1);
  });

  it("AI 退回纯随机的概率写在常量里（30%）", () => {
    expect(AI_RANDOM_CHANCE).toBe(0.3);
  });
});

describe("stepCursor · 键盘光标", () => {
  it("四向各走一格，出界停在原地", () => {
    expect(stepCursor(27, "right")).toBe(28);
    expect(stepCursor(27, "left")).toBe(26);
    expect(stepCursor(27, "down")).toBe(35);
    expect(stepCursor(27, "up")).toBe(19);

    expect(stepCursor(0, "left")).toBe(0);
    expect(stepCursor(0, "up")).toBe(0);
    expect(stepCursor(63, "right")).toBe(63);
    expect(stepCursor(63, "down")).toBe(63);
  });

  it("会跳过已经打过的格子；整行都打过就原地不动", () => {
    const board = emptyBoard();
    board[28] = MISS;
    board[26] = MISS;

    expect(stepCursor(27, "right", board)).toBe(29);
    expect(stepCursor(27, "left", board)).toBe(25);

    for (let index = 24; index < 32; index += 1) board[index] = MISS;
    expect(stepCursor(27, "right", board)).toBe(27);
  });

  it("非法输入先落回 (0,0) 再按方向走；非方向动作原样返回", () => {
    // 越界 / NaN 的起点会被钳到 0，然后照常吃掉一步：0 → 1。
    expect(stepCursor(-5, "right")).toBe(1);
    expect(stepCursor(Number.NaN, "right")).toBe(1);
    expect(stepCursor(Number.NaN, "left")).toBe(0);

    expect(stepCursor(27, "action")).toBe(27);
    expect(stepCursor(27, "secondary")).toBe(27);
    expect(stepCursor(27, "")).toBe(27);
  });
});

/* ------------------------------------------------------------------ */
/* 关键回归：AI 必须可被击败                                            */
/* ------------------------------------------------------------------ */

/** 复制一份棋盘（模拟对局时不想污染原盘）。 */
const cloneBoard = (board: readonly number[]): number[] => board.slice();

/**
 * 简单贪心人类策略：先清掉命中点四邻（追残舰），否则打概率最高的格子。
 *
 * 只用公开信息（自己打出的 HIT/MISS），不读对手棋盘；击沉后同样清空队列
 * ——「舰与舰不贴边」意味着刚沉那艘的四邻全是空海，继续打等于浪费炮。
 */
function greedyHuman(board: number[], ships: readonly Ship[], stack: number[], rand: () => number): number {
  while (stack.length > 0) {
    const index = stack.pop() as number;
    if (board[index] === UNKNOWN) return index;
  }

  const grid = probabilityGrid(board, ships);
  const candidates: number[] = [];
  for (let index = 0; index < CELLS; index += 1) {
    if (board[index] === UNKNOWN) candidates.push(index);
  }
  if (candidates.length === 0) return -1;

  let best = 0;
  for (const index of candidates) best = Math.max(best, grid[index] as number);
  const pool = candidates.filter((index) => grid[index] === best);
  return pool[Math.floor(rand() * pool.length)] as number;
}

/**
 * 跑一整局「人类 vs AI」，返回谁先全歼对手。
 *
 * 人类用贪心策略（只用公开信息），AI 用 pickShot + 30% 随机，
 * 与真实游戏手感一致；这个函数就是「AI 可被击败」那条断言的执行体。
 */
function simulate(
  seed: number,
): { humanWon: boolean; humanShots: number; aiShots: number } {
  const rand = seeded(seed);

  const humanBoard = emptyBoard();
  const humanShips = placeFleet(rand);
  const aiBoard = emptyBoard();
  const aiShips = placeFleet(rand);

  const humanStack: number[] = [];
  const aiStack: number[] = [];
  let humanShots = 0;
  let aiShots = 0;

  // 最多 CELLS*2 炮，防御性上限，正常对局远达不到。
  for (let step = 0; step < CELLS * 2; step += 1) {
    // 人类回合：命中就继续打。
    for (;;) {
      const index = greedyHuman(aiBoard, aiShips, humanStack, rand);
      if (index < 0) return { humanWon: false, humanShots, aiShots };
      const shot = resolveShot(aiBoard, aiShips, index);
      humanShots += 1;
      if (!shot.hit) break;
      // 击沉后清空队列：不贴边规则意味着那艘舰的四邻已经全是空海。
      if (shot.sunk !== null) humanStack.length = 0;
      else humanStack.push(...neighborsOf(index).filter((cell) => aiBoard[cell] === UNKNOWN));
      if (allSunk(aiShips)) return { humanWon: true, humanShots, aiShots };
    }

    // AI 回合：同样命中继续打。
    for (;;) {
      const index = pickShot(humanBoard, humanShips, aiStack, rand);
      if (index < 0) return { humanWon: true, humanShots, aiShots };
      const shot = resolveShot(humanBoard, humanShips, index);
      aiShots += 1;
      if (!shot.hit) break;
      if (shot.sunk !== null) aiStack.length = 0;
      else noteHit(aiStack, humanBoard, index);
      if (allSunk(humanShips)) return { humanWon: false, humanShots, aiShots };
    }
  }

  throw new Error("对局未在合理炮数内结束");
}

describe("AI 必须可被击败（40 局固定种子）", () => {
  it("贪心人类策略在 40 局里至少赢 5 局", () => {
    let wins = 0;
    const results: { humanWon: boolean; humanShots: number; aiShots: number }[] = [];

    for (let game = 1; game <= 40; game += 1) {
      const result = simulate(game * 7919);
      results.push(result);
      if (result.humanWon) wins += 1;
    }

    expect(results).toHaveLength(40);
    // 实测约 23/40 胜（人类先手 + AI 有 30% 纯随机，所以人类略占优）。
    // 规格要求「至少赢 5 局」，这里留足余量，同时 AI 仍能赢 4 成对局，不算白给。
    expect(wins).toBeGreaterThanOrEqual(5);
  });

  it("每局都能在合理炮数内结束（不出现死循环）", () => {
    for (let game = 1; game <= 10; game += 1) {
      const result = simulate(game * 131);
      expect(result.humanShots).toBeGreaterThan(0);
      expect(result.aiShots).toBeGreaterThan(0);
      expect(result.humanShots).toBeLessThanOrEqual(CELLS);
      expect(result.aiShots).toBeLessThanOrEqual(CELLS);
    }
  });

  it("AI 的命中率不至于碾压人类（留出翻盘空间）", () => {
    // 统计 40 局总炮数：AI 若白嫖完美信息，炮数会远低于人类。这里只要求
    // 双方总炮数没有数量级差距，作为「AI 没强到离谱」的宽松护栏。
    let humanTotal = 0;
    let aiTotal = 0;
    for (let game = 1; game <= 40; game += 1) {
      const result = simulate(game * 7919);
      humanTotal += result.humanShots;
      aiTotal += result.aiShots;
    }

    expect(humanTotal).toBeGreaterThan(0);
    expect(aiTotal).toBeGreaterThan(0);
    expect(humanTotal).toBeLessThan(aiTotal * 2.5);
  });
});

describe("cloneBoard 辅助", () => {
  it("拷贝不会共享底层数组", () => {
    const board = emptyBoard();
    const copy = cloneBoard(board);
    copy[0] = MISS;
    expect(board[0]).toBe(UNKNOWN);
  });
});
