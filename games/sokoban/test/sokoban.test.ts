import { describe, expect, it } from "vitest";

import {
  CELLS,
  LEVELS,
  LEVEL_COUNT,
  SIZE,
  boxCount,
  boxRatio,
  boxesOnGoals,
  canUndo,
  createState,
  dirFromAction,
  goalCount,
  isWin,
  move,
  parseLevel,
  undo,
  type Dir,
} from "../src/logic";

/** 解序列里的字母 → 方向名。 */
const STEP: Record<string, Dir> = {
  U: "up",
  D: "down",
  L: "left",
  R: "right",
};

/**
 * 六关写死的解（由 BFS 求出，测试里逐步回放）：
 * 第 N 关的步数就是 SOLUTIONS[N-1].steps，六关合计 77 步。
 */
const SOLUTIONS: readonly { path: string; steps: number }[] = [
  { path: "UULUR", steps: 5 },
  { path: "UUDDRUU", steps: 7 },
  { path: "UUDRDRUULUL", steps: 11 },
  { path: "UUDDLUUDDLUU", steps: 12 },
  { path: "LLUULURDDDDLUUULUR", steps: 18 },
  { path: "RUURULDDDLLUUDRDRUUDDRUU", steps: 24 },
];

/** 空房间：8×8 全墙边框，内部全是地板。 */
const ROOM = [
  "########",
  "#      #",
  "#      #",
  "#      #",
  "#      #",
  "#      #",
  "#      #",
  "########",
];

/** 换掉某一行，方便拼测试场景。 */
function replace(rows: readonly string[], index: number, line: string): string[] {
  const next = rows.slice();
  next[index] = line;
  return next;
}

/** 站在 (1,1) 的玩家。 */
const WALK = replace(ROOM, 1, "#@     #");
/** 顶上一排没有墙，玩家站在 (1,0)，用来测越界。 */
const OPEN_TOP = replace(ROOM, 0, "        ");
const EDGE_PLAYER = replace(OPEN_TOP, 1, "@       ");

/** 玩家 (1,1)、箱子 (1,2)、空地 (1,3)、目标点 (1,4)。 */
const PUSH_RIGHT = replace(ROOM, 1, "#@$ .  #");
/** 玩家 (1,1)、箱子 (1,2)、墙 (1,3)。 */
const PUSH_INTO_WALL = replace(ROOM, 1, "#@$#   #");
/** 玩家 (1,1)、两个箱子 (1,2)(1,3)。 */
const PUSH_TWO_BOXES = replace(ROOM, 1, "#@$$   #");

/** 按顺序回放一串「UDLR」，返回最终状态与最后一步的 win 标记。 */
function replay(rows: readonly string[], path: string) {
  let state = createState(rows);
  let moved = 0;
  let win = false;
  for (const letter of path) {
    const direction = STEP[letter];
    if (!direction) throw new Error(`未知方向：${letter}`);
    const result = move(state, direction);
    if (!result.moved) throw new Error(`第 ${moved + 1} 步走不动：${letter}`);
    state = result.state;
    win = result.win;
    moved += 1;
  }
  return { state, win, moved };
}

describe("关卡与常量", () => {
  it("8×8 网格、六关", () => {
    expect(SIZE).toBe(8);
    expect(CELLS).toBe(64);
    expect(LEVEL_COUNT).toBe(6);
    expect(LEVELS).toHaveLength(LEVEL_COUNT);
  });

  it("六关都是 8 行 × 8 列，四周是墙、只有一个玩家", () => {
    for (let index = 0; index < LEVELS.length; index += 1) {
      const rows = LEVELS[index]!;
      expect(rows).toHaveLength(SIZE);
      for (let row = 0; row < SIZE; row += 1) {
        expect(rows[row]).toHaveLength(SIZE);
      }

      const flat = rows.join("");
      expect(flat.split("@").length - 1).toBe(1);

      const border =
        rows[0]! + rows[SIZE - 1]! + rows.map((line) => line[0]!).join("");
      expect([...border].every((ch) => ch === "#")).toBe(true);
    }
  });

  it("六关的箱子数和目标点数一致，且都不为空", () => {
    for (let index = 0; index < LEVELS.length; index += 1) {
      const level = parseLevel(LEVELS[index]!);
      expect(boxCount(level)).toBeGreaterThan(0);
      expect(goalCount(level)).toBe(boxCount(level));
    }
  });
});

describe("parseLevel", () => {
  it("认得墙、目标点、箱子、玩家，以及 * 和 + 两种叠加格", () => {
    const level = parseLevel([
      "########",
      "#  .   #",
      "#  $   #",
      "#  @   #",
      "#  *   #",
      "#  +   #",
      "#      #",
      "########",
    ]);

    expect(level.walls[0]).toBe(true);
    expect(level.walls[9]).toBe(false);
    // 目标点：(1,3) 是 '.'、(4,3) 与 (5,3) 来自 '*' 与 '+'。
    expect(level.goals[1 * SIZE + 3]).toBe(true);
    expect(level.goals[4 * SIZE + 3]).toBe(true);
    expect(level.goals[5 * SIZE + 3]).toBe(true);
    // 箱子：(2,3) 是 '$'，(4,3) 是 '*'。
    expect(level.boxes[2 * SIZE + 3]).toBe(true);
    expect(level.boxes[4 * SIZE + 3]).toBe(true);
    expect(boxCount(level)).toBe(2);
    expect(goalCount(level)).toBe(3);
    // '+' 既是目标点也是玩家。
    expect(level.player).toBe(5 * SIZE + 3);
  });

  it("短行按地板补齐、多余的行列忽略，不越界", () => {
    const short = parseLevel(["########", "#@", "########"]);
    expect(short.player).toBe(1 * SIZE + 1);
    expect(short.walls).toHaveLength(CELLS);
    expect(short.goals.every((value) => value === false)).toBe(true);

    const long = parseLevel(["##########", "#        #", "#  .     #"]);
    expect(long.walls).toHaveLength(CELLS);
    expect(long.goals[2 * SIZE + 3]).toBe(true);
  });
});

describe("move · 走与推的判定", () => {
  it("走到空格：moved 为真、pushed 为假，步数 +1", () => {
    const start = createState(WALK);
    const result = move(start, "down");

    expect(result.moved).toBe(true);
    expect(result.pushed).toBe(false);
    expect(result.state.player).toBe(start.player + SIZE);
    expect(result.state.moves).toBe(1);
    expect(result.state.history).toHaveLength(1);
  });

  it("走到墙：走不动，状态原样返回", () => {
    const start = createState(WALK);
    const result = move(start, "up");

    expect(result.moved).toBe(false);
    expect(result.pushed).toBe(false);
    expect(result.state).toBe(start);
    expect(start.moves).toBe(0);
  });

  it("走出网格边界也算走不动", () => {
    const start = createState(EDGE_PLAYER);
    expect(start.player).toBe(1 * SIZE);

    const left = move(start, "left");
    expect(left.moved).toBe(false);
    expect(left.state.player).toBe(start.player);

    const up = move(start, "up");
    expect(up.moved).toBe(true);
    expect(up.state.player).toBe(0);
  });

  it("推箱子进空格：箱子跟着走，玩家进箱子原来的位置", () => {
    const start = createState(PUSH_RIGHT);
    const result = move(start, "right");

    expect(result.moved).toBe(true);
    expect(result.pushed).toBe(true);
    expect(result.win).toBe(false);
    expect(result.state.player).toBe(1 * SIZE + 2);
    expect(result.state.boxes[1 * SIZE + 3]).toBe(true);
    expect(result.state.boxes[1 * SIZE + 2]).toBe(false);
  });

  it("推箱子进墙：推不动，箱子和玩家都不动", () => {
    const start = createState(PUSH_INTO_WALL);
    const result = move(start, "right");

    expect(result.moved).toBe(false);
    expect(result.pushed).toBe(false);
    expect(result.state).toBe(start);
    expect(result.state.boxes[1 * SIZE + 2]).toBe(true);
  });

  it("一次推两个箱子：推不动", () => {
    const start = createState(PUSH_TWO_BOXES);
    const result = move(start, "right");

    expect(result.moved).toBe(false);
    expect(result.pushed).toBe(false);
    expect(result.state).toBe(start);
    expect(boxCount(start)).toBe(2);
  });

  it("把箱子推到目标点上：就位数 +1、比例到 1，并且过关", () => {
    const start = createState(PUSH_RIGHT);
    expect(boxesOnGoals(start)).toBe(0);
    expect(boxRatio(start)).toBe(0);

    const onFloor = move(start, "right");
    expect(onFloor.win).toBe(false);
    expect(boxesOnGoals(onFloor.state)).toBe(0);

    const onGoal = move(onFloor.state, "right");
    expect(onGoal.win).toBe(true);
    expect(boxesOnGoals(onGoal.state)).toBe(1);
    expect(boxRatio(onGoal.state)).toBe(1);
  });
});

describe("isWin 与 boxRatio", () => {
  it("开局不算赢，全部箱子在目标点上才赢", () => {
    const start = createState(PUSH_RIGHT);
    expect(isWin(start)).toBe(false);

    const { state } = replay(PUSH_RIGHT, "RR");
    expect(isWin(state)).toBe(true);
    expect(boxesOnGoals(state)).toBe(1);
  });

  it("有箱子离开目标点就立刻不算赢", () => {
    const solved = replay(PUSH_RIGHT, "RR");
    expect(isWin(solved.state)).toBe(true);

    // 再往前顶一格，箱子离开目标点。
    const away = replay(PUSH_RIGHT, "RRR");
    expect(away.state.boxes[1 * SIZE + 5]).toBe(true);
    expect(away.state.boxes[1 * SIZE + 4]).toBe(false);
    expect(isWin(away.state)).toBe(false);
  });

  it("boxRatio 反映就位比例", () => {
    expect(boxRatio(createState(WALK))).toBe(0);

    const none = replay(LEVELS[1]!, "U");
    expect(boxesOnGoals(none.state)).toBe(0);
    expect(boxRatio(none.state)).toBe(0);

    const one = replay(LEVELS[1]!, "UU");
    expect(boxesOnGoals(one.state)).toBe(1);
    expect(boxRatio(one.state)).toBe(0.5);

    const two = replay(LEVELS[1]!, "UUDDRUU");
    expect(boxesOnGoals(two.state)).toBe(2);
    expect(boxRatio(two.state)).toBe(1);
  });
});

describe("undo · 撤销", () => {
  it("撤销把玩家和箱子一起退回上一步", () => {
    const start = createState(PUSH_RIGHT);
    const pushed = move(start, "right").state;
    expect(pushed.player).toBe(1 * SIZE + 2);
    expect(pushed.boxes[1 * SIZE + 3]).toBe(true);
    expect(pushed.moves).toBe(1);

    const back = undo(pushed);
    expect(back.player).toBe(start.player);
    expect(back.boxes).toEqual(start.boxes);
    // 步数不因撤销而减少。
    expect(back.moves).toBe(1);
    expect(canUndo(back)).toBe(false);
  });

  it("没有可撤销的步骤时原样返回", () => {
    const start = createState(WALK);
    const back = undo(start);
    expect(back).toBe(start);
    expect(canUndo(start)).toBe(false);
  });

  it("连续撤销能一步步回到开局", () => {
    const start = createState(LEVELS[3]!);
    const { state } = replay(LEVELS[3]!, "UUDDLUUDDLUU");
    expect(state.moves).toBe(12);
    expect(isWin(state)).toBe(true);

    let current = state;
    for (let i = 0; i < 12; i += 1) {
      expect(canUndo(current)).toBe(true);
      current = undo(current);
    }
    expect(current.player).toBe(start.player);
    expect(current.boxes).toEqual(start.boxes);
    expect(current.history).toHaveLength(0);
    // 撤销不回退步数。
    expect(current.moves).toBe(12);
    expect(isWin(current)).toBe(false);
  });

  it("撤销后可以继续走，撤销栈继续记录", () => {
    const start = createState(WALK);
    const once = move(start, "down").state;
    const back = undo(once);
    const again = move(back, "right");

    expect(again.moved).toBe(true);
    // 走一步 + 撤销后再走一步 = 2 步。
    expect(again.state.moves).toBe(2);
    expect(again.state.history).toHaveLength(1);
    expect(undo(again.state).player).toBe(start.player);
  });
});

describe("六关都有解 · 回放写死的解序列", () => {
  LEVELS.forEach((rows, index) => {
    it(`第 ${index + 1} 关：${SOLUTIONS[index]!.path}`, () => {
      const solution = SOLUTIONS[index]!;
      let state = createState(rows);
      expect(isWin(state)).toBe(false);

      for (let i = 0; i < solution.path.length; i += 1) {
        const letter = solution.path[i]!;
        const result = move(state, STEP[letter]!);
        // 每一步都必须是合法移动，不允许撞墙或推不动。
        expect(result.moved).toBe(true);
        state = result.state;
        // 过关只发生在最后一步。
        if (i < solution.path.length - 1) expect(isWin(state)).toBe(false);
      }

      expect(state.moves).toBe(solution.steps);
      expect(state.moves).toBe(solution.path.length);
      expect(isWin(state)).toBe(true);
      expect(boxRatio(state)).toBe(1);
      // 所有箱子都落在目标点上。
      for (let cell = 0; cell < CELLS; cell += 1) {
        if (state.boxes[cell]) expect(state.goals[cell]).toBe(true);
      }
      // 撤销最后一步后立刻不再是过关状态，证明这一步是决胜步。
      expect(isWin(undo(state))).toBe(false);
    });
  });

  it("六关解序列合计 77 步，低分就是这 77 步", () => {
    const total = SOLUTIONS.reduce((sum, item) => sum + item.steps, 0);
    expect(total).toBe(77);

    let all = 0;
    LEVELS.forEach((rows, index) => {
      const { state } = replay(rows, SOLUTIONS[index]!.path);
      expect(isWin(state)).toBe(true);
      all += state.moves;
    });
    expect(all).toBe(77);
  });
});

describe("方向动作映射", () => {
  it("只认四个方向动作", () => {
    expect(dirFromAction("up")).toBe("up");
    expect(dirFromAction("down")).toBe("down");
    expect(dirFromAction("left")).toBe("left");
    expect(dirFromAction("right")).toBe("right");
    expect(dirFromAction("secondary")).toBe(null);
    expect(dirFromAction("action")).toBe(null);
  });
});
