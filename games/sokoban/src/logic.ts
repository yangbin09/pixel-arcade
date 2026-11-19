/**
 * 推箱子纯规则层：关卡解析、推箱判定、胜利判定、撤销。
 *
 * 不碰 DOM / Canvas，也不依赖任何随机源：同一串输入永远得到同一个状态，
 * 所以「推墙失败」「推两个箱子失败」「撤销复原」「六关都有解」都能直接单测。
 */

export const SIZE = 8;
export const CELLS = SIZE * SIZE;
/** 总关数：六关递进，六关步数相加就是本局低分成绩。 */
export const LEVEL_COUNT = 6;

export type Dir = "up" | "down" | "left" | "right";

/** 一条撤销记录：玩家的旧位置 + 这次被推的箱子（没推箱子时 from/to 为 -1）。 */
export interface Step {
  player: number;
  from: number;
  to: number;
}

/** 静态关卡：墙、目标点、初始箱子、玩家起点。 */
export interface Level {
  walls: boolean[];
  goals: boolean[];
  boxes: boolean[];
  player: number;
}

/** 可推进的关卡状态：静态关卡 + 撤销栈 + 已走步数。 */
export interface SokobanState extends Level {
  /** 撤销栈，每成功走一步压一条；撤销不弹出步数。 */
  history: Step[];
  /** 本关实际移动步数；撤销不回退（步数按实际移动计）。 */
  moves: number;
}

export interface MoveResult {
  /** 新状态；走不动时原样返回同一个对象。 */
  state: SokobanState;
  moved: boolean;
  /** 这一步是否推动了箱子。 */
  pushed: boolean;
  win: boolean;
}

export const DIRECTIONS: readonly Dir[] = ["up", "down", "left", "right"];

const DELTA: Record<Dir, { dr: number; dc: number }> = {
  up: { dr: -1, dc: 0 },
  down: { dr: 1, dc: 0 },
  left: { dr: 0, dc: -1 },
  right: { dr: 0, dc: 1 },
};

/** 键盘 / 手柄动作名 → 方向；不是方向动作返回 null。 */
export function dirFromAction(action: string): Dir | null {
  return action === "up" || action === "down" || action === "left" || action === "right"
    ? action
    : null;
}

export const rowOf = (index: number): number => Math.floor(index / SIZE);
export const colOf = (index: number): number => index % SIZE;
export const indexOf = (row: number, col: number): number => row * SIZE + col;
export const inGrid = (row: number, col: number): boolean =>
  row >= 0 && col >= 0 && row < SIZE && col < SIZE;

/**
 * 字符串关卡 → 结构化关卡。
 *
 * `#` 墙、`.` 目标点、`$` 箱子、`@` 玩家、`*` 箱子在目标点上、`+` 玩家在目标点上，
 * 其余字符（含空格）都是可以走的地板。越界的行/列会被忽略，短行按地板补齐。
 */
export function parseLevel(rows: readonly string[]): Level {
  const walls = new Array<boolean>(CELLS).fill(false);
  const goals = new Array<boolean>(CELLS).fill(false);
  const boxes = new Array<boolean>(CELLS).fill(false);
  let player = 0;

  const height = Math.min(rows.length, SIZE);
  for (let row = 0; row < height; row += 1) {
    const line = rows[row] ?? "";
    const width = Math.min(line.length, SIZE);
    for (let col = 0; col < width; col += 1) {
      const ch = line[col];
      const index = indexOf(row, col);
      if (ch === "#") walls[index] = true;
      if (ch === "." || ch === "*" || ch === "+") goals[index] = true;
      if (ch === "$" || ch === "*") boxes[index] = true;
      if (ch === "@" || ch === "+") player = index;
    }
  }

  return { walls, goals, boxes, player };
}

/** 从字符串关卡建一个可推进的状态：撤销栈清空、步数归零。 */
export function createState(rows: readonly string[]): SokobanState {
  return { ...parseLevel(rows), history: [], moves: 0 };
}

export function boxCount(state: Level): number {
  let count = 0;
  for (let index = 0; index < CELLS; index += 1) if (state.boxes[index]) count += 1;
  return count;
}

export function goalCount(state: Level): number {
  let count = 0;
  for (let index = 0; index < CELLS; index += 1) if (state.goals[index]) count += 1;
  return count;
}

/** 已就位的箱子数，HUD 的 boxes 栏直接用。 */
export function boxesOnGoals(state: Level): number {
  let count = 0;
  for (let index = 0; index < CELLS; index += 1) {
    if (state.boxes[index] && state.goals[index]) count += 1;
  }
  return count;
}

/** 就位比例 0–1；没有目标点时返回 0。 */
export function boxRatio(state: Level): number {
  const goals = goalCount(state);
  if (goals <= 0) return 0;
  return Math.min(1, boxesOnGoals(state) / goals);
}

/** 每个目标点都有箱子、且没有箱子停在目标点之外，才算过关。 */
export function isWin(state: Level): boolean {
  let goals = 0;
  for (let index = 0; index < CELLS; index += 1) {
    if (state.goals[index]) {
      if (!state.boxes[index]) return false;
      goals += 1;
      continue;
    }
    if (state.boxes[index]) return false;
  }
  return goals > 0;
}

/**
 * 走一步。返回新状态（不修改入参）。
 *
 * 规则只有三条：墙不能进；箱子只能被「推」，箱子后面是墙或另一个箱子就推不动；
 * 人走到箱子的位置即视为推。撤销栈记录玩家旧位置与被推箱子的位移。
 */
export function move(state: SokobanState, dir: Dir): MoveResult {
  const delta = DELTA[dir];
  if (!delta) return { state, moved: false, pushed: false, win: isWin(state) };

  const row = rowOf(state.player);
  const col = colOf(state.player);
  const nextRow = row + delta.dr;
  const nextCol = col + delta.dc;
  if (!inGrid(nextRow, nextCol)) return { state, moved: false, pushed: false, win: isWin(state) };

  const target = indexOf(nextRow, nextCol);
  if (state.walls[target]) return { state, moved: false, pushed: false, win: isWin(state) };

  const boxes = state.boxes.slice();
  if (boxes[target]) {
    const beyondRow = nextRow + delta.dr;
    const beyondCol = nextCol + delta.dc;
    // 推入边界 / 推入墙 / 推入另一个箱子，都算推不动。
    if (!inGrid(beyondRow, beyondCol)) {
      return { state, moved: false, pushed: false, win: isWin(state) };
    }
    const beyond = indexOf(beyondRow, beyondCol);
    if (state.walls[beyond] || boxes[beyond]) {
      return { state, moved: false, pushed: false, win: isWin(state) };
    }

    boxes[target] = false;
    boxes[beyond] = true;

    const next: SokobanState = {
      walls: state.walls,
      goals: state.goals,
      boxes,
      player: target,
      history: [...state.history, { player: state.player, from: target, to: beyond }],
      moves: state.moves + 1,
    };
    return { state: next, moved: true, pushed: true, win: isWin(next) };
  }

  const next: SokobanState = {
    walls: state.walls,
    goals: state.goals,
    boxes,
    player: target,
    history: [...state.history, { player: state.player, from: -1, to: -1 }],
    moves: state.moves + 1,
  };
  return { state: next, moved: true, pushed: false, win: isWin(next) };
}

export function canUndo(state: SokobanState): boolean {
  return state.history.length > 0;
}

/**
 * 撤销一步：箱子位置与玩家位置一起复原，步数保持不变。
 * 没有可撤销的步骤时原样返回。
 */
export function undo(state: SokobanState): SokobanState {
  const last = state.history[state.history.length - 1];
  if (!last) return state;

  const boxes = state.boxes.slice();
  if (last.from >= 0 && last.to >= 0) {
    boxes[last.from] = true;
    boxes[last.to] = false;
  }

  return {
    walls: state.walls,
    goals: state.goals,
    boxes,
    player: last.player,
    history: state.history.slice(0, -1),
    moves: state.moves,
  };
}

/**
 * 六张手写关卡，8×8，起点 (8,8)、cell 19、间距 1。
 * 每张都在单测里用写死的解序列跑通，见 test/sokoban.test.ts。
 */
export const LEVELS: readonly string[][] = [
  // 1：一个箱子，先向前推到底，再绕到侧面补最后一下。
  [
    "########",
    "#      #",
    "#   .  #",
    "#      #",
    "#  $   #",
    "#  @   #",
    "#      #",
    "########",
  ],
  // 2：两个箱子并排向上推，中间要退回去换一边。
  [
    "########",
    "#      #",
    "#  ..  #",
    "#      #",
    "#  $$  #",
    "#  @   #",
    "#      #",
    "########",
  ],
  // 3：目标点拉开距离，右边的箱子要横推两格再上推。
  [
    "########",
    "#      #",
    "# .  . #",
    "#      #",
    "#  $$  #",
    "#  @   #",
    "#      #",
    "########",
  ],
  // 4：三个箱子、三个目标点，经典的「先右后左」往返。
  [
    "########",
    "#      #",
    "# ...  #",
    "#      #",
    "# $$$  #",
    "#   @  #",
    "#      #",
    "########",
  ],
  // 5：室内有柱子，箱子得绕开柱子从下方顶上去。
  [
    "########",
    "#      #",
    "#  ..  #",
    "#   ## #",
    "#  $   #",
    "#  $ @ #",
    "#      #",
    "########",
  ],
  // 6：最后一张，四个箱子 + 两根柱子，路线最长。
  [
    "########",
    "#      #",
    "# .... #",
    "#  #   #",
    "# $$$$ #",
    "#  @   #",
    "#  #   #",
    "########",
  ],
];
