/**
 * 记忆节拍纯规则层：序列生成、复现判定、回放节奏、计分，以及显式的阶段机。
 *
 * 不碰 DOM / Canvas / 定时器：时间都是调用方传进来的毫秒数，随机源也可以注入，
 * 所以「回放期间输入无效」「序列只增不减」「速度下限」「计分」都能直接单测。
 */

/** 四个动作名同时是虚拟手柄的四个方向，也是四色的键名。 */
export const COLORS = ["up", "right", "down", "left"] as const;

export type SimonColor = (typeof COLORS)[number];

/** 四色音高（Hz）：up < right < down < left，四个音必须互不相同。 */
export const TONE_HZ: Record<SimonColor, number> = {
  up: 392,
  right: 523,
  down: 659,
  left: 784,
};

/**
 * 显式阶段：回放中 / 等待玩家复现 / 已结束。
 * 输入只认 `awaiting-input`，因此「回放期间按了也不算」是规则层保证的。
 */
export type SimonPhase = "playing-back" | "awaiting-input" | "over";

/** 复现判定：还没按完 / 全对 / 按错。 */
export type Verdict = "playing" | "correct" | "wrong";

/** 一次按键的结果：阶段不对就直接忽略。 */
export type PressResult = "ignored" | Verdict;

/** 回放节奏：第一步 420ms，每轮缩短 20ms，最低 180ms。 */
export const STEP_MS_START = 420;
export const STEP_MS_MIN = 180;
export const STEP_MS_DECAY = 20;
/** 步间停顿固定 120ms。 */
export const GAP_MS = 120;
/** 每次正确复现得分 = 轮次 × 10。 */
export const ROUND_SCORE = 10;

export interface SimonState {
  /** 当前轮次，从 1 开始；等于本回合序列长度。 */
  round: number;
  /** 本回合要复现的整段序列。 */
  sequence: SimonColor[];
  /** 玩家已经按下的部分。 */
  inputs: SimonColor[];
  phase: SimonPhase;
  score: number;
  /** 已经成功复现过的最长序列长度，结算用。 */
  longest: number;
}

/** 轮次归一到「1 起的整数」，非法输入按第 1 轮算。 */
function safeRound(round: number): number {
  if (!Number.isFinite(round)) return 1;
  return Math.max(1, Math.floor(round));
}

/** 每步亮灯时长：随轮次线性缩短，夹在 180ms 下限上。 */
export function playbackSpeedForRound(round: number): number {
  const r = safeRound(round);
  return Math.max(STEP_MS_MIN, STEP_MS_START - (r - 1) * STEP_MS_DECAY);
}

/** 步间停顿：规格固定 120ms，轮次只影响亮灯时长，不影响停顿。 */
export function pauseForRound(_round: number): number {
  return GAP_MS;
}

/** 正确复现一整轮得分。 */
export function scoreForRound(round: number): number {
  if (!Number.isFinite(round)) return 0;
  return Math.max(0, Math.floor(round)) * ROUND_SCORE;
}

/** 动作名是否属于四色之一（键盘方向键 / 手柄 D-pad 共用这套名字）。 */
export function isColor(value: string): value is SimonColor {
  return (COLORS as readonly string[]).includes(value);
}

/**
 * 序列追加一步：返回新数组，不改传入的数组。
 * 随机源被夹到 [0, 1)，极端值也不会越界；非有限值当 0 处理。
 */
export function nextStep(seq: readonly SimonColor[], rng: () => number = Math.random): SimonColor[] {
  const out = seq.slice();
  const raw = rng();
  const unit = Number.isFinite(raw) ? Math.min(0.999999, Math.max(0, raw)) : 0;
  out.push(COLORS[Math.floor(unit * COLORS.length)] as SimonColor);
  return out;
}

/**
 * 复现判定：拿玩家输入去对序列前缀。
 * - 任何一位不对 → wrong
 * - 输入比序列长（多按）→ wrong
 * - 刚好按完且全对 → correct
 * - 其余（含空序列）→ playing
 */
export function judge(sequence: readonly SimonColor[], inputs: readonly SimonColor[]): Verdict {
  const shared = Math.min(sequence.length, inputs.length);
  for (let i = 0; i < shared; i += 1) {
    if (sequence[i] !== inputs[i]) return "wrong";
  }
  if (inputs.length > sequence.length) return "wrong";
  if (sequence.length > 0 && inputs.length === sequence.length) return "correct";
  return "playing";
}

/** 开局状态：第 1 轮、1 步序列、处于回放阶段。 */
export function createState(rng: () => number = Math.random): SimonState {
  return {
    round: 1,
    sequence: nextStep([], rng),
    inputs: [],
    phase: "playing-back",
    score: 0,
    longest: 0,
  };
}

/** 回放播完 → 交给玩家复现。重复调用不会把状态往回带。 */
export function beginInput(state: SimonState): SimonState {
  if (state.phase !== "playing-back") return state;
  return { ...state, phase: "awaiting-input" };
}

/** 重听本回合：清空已按步骤，回到回放阶段（已结束的局不能重听）。 */
export function replayRound(state: SimonState): SimonState {
  if (state.phase === "over") return state;
  return { ...state, inputs: [], phase: "playing-back" };
}

export interface PressOutcome {
  state: SimonState;
  result: PressResult;
}

/**
 * 按下一个颜色。
 *
 * **回放期间的输入一律忽略**：阶段不是 `awaiting-input` 时直接返回原状态对象，
 * 调用方可以用引用相等证明「什么都没发生」。
 */
export function press(state: SimonState, color: SimonColor): PressOutcome {
  if (state.phase !== "awaiting-input") return { state, result: "ignored" };

  const inputs = [...state.inputs, color];
  const verdict = judge(state.sequence, inputs);

  if (verdict === "wrong") {
    return { state: { ...state, inputs, phase: "over" }, result: "wrong" };
  }

  if (verdict === "correct") {
    return {
      state: {
        ...state,
        inputs,
        score: state.score + scoreForRound(state.round),
        longest: Math.max(state.longest, state.sequence.length),
      },
      result: "correct",
    };
  }

  return { state: { ...state, inputs }, result: "playing" };
}

/**
 * 一整轮复现成功后进入下一轮：轮次 +1、序列再追加一步、清空输入、回到回放。
 * 没按完或阶段不对时原样返回，避免误推进。
 */
export function advanceRound(state: SimonState, rng: () => number = Math.random): SimonState {
  if (state.phase !== "awaiting-input") return state;
  if (judge(state.sequence, state.inputs) !== "correct") return state;
  return {
    ...state,
    round: state.round + 1,
    sequence: nextStep(state.sequence, rng),
    inputs: [],
    phase: "playing-back",
  };
}
