import { describe, expect, it } from "vitest";

import {
  COLORS,
  GAP_MS,
  ROUND_SCORE,
  STEP_MS_MIN,
  STEP_MS_START,
  TONE_HZ,
  advanceRound,
  beginInput,
  createState,
  isColor,
  judge,
  nextStep,
  pauseForRound,
  playbackSpeedForRound,
  press,
  replayRound,
  scoreForRound,
  type SimonColor,
  type SimonState,
} from "../src/logic";

/** 可复现随机源：同一个种子跑出同一串颜色。 */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

/** 固定序列的测试状态：直接处在等待复现阶段。 */
function stateWith(sequence: SimonColor[], round = sequence.length): SimonState {
  return {
    round,
    sequence: sequence.slice(),
    inputs: [],
    phase: "awaiting-input",
    score: 0,
    longest: 0,
  };
}

describe("常量与四色", () => {
  it("四个动作名互不相同，且只有这四个", () => {
    expect(COLORS).toHaveLength(4);
    expect(new Set(COLORS).size).toBe(4);
    expect([...COLORS].sort()).toEqual(["down", "left", "right", "up"]);
    for (const color of COLORS) expect(isColor(color)).toBe(true);
    expect(isColor("action")).toBe(false);
    expect(isColor("")).toBe(false);
  });

  it("四色各有一个互不相同的音高", () => {
    const freqs = COLORS.map((color) => TONE_HZ[color]);
    expect(new Set(freqs).size).toBe(4);
    for (const hz of freqs) expect(hz).toBeGreaterThan(0);
  });
});

describe("nextStep · 序列只增长不缩短", () => {
  it("在原序列末尾追加一步，且不改动传入的数组", () => {
    const base: SimonColor[] = ["up", "left"];
    const step = nextStep(base, seeded(7));

    expect(base).toEqual(["up", "left"]);
    expect(step).toHaveLength(3);
    expect(step.slice(0, 2)).toEqual(["up", "left"]);
    expect(isColor(step[2] as string)).toBe(true);
  });

  it("连续追加只会变长，前缀永远保持", () => {
    const rng = seeded(2024);
    let seq: SimonColor[] = [];
    for (let round = 1; round <= 25; round += 1) {
      const before = seq.slice();
      seq = nextStep(seq, rng);
      expect(seq).toHaveLength(round);
      expect(seq.slice(0, before.length)).toEqual(before);
    }
  });

  it("随机源取极端值时仍落在四色之内", () => {
    for (const rng of [() => 0, () => 0.999999, () => 1, () => -3, () => Number.NaN]) {
      const step = nextStep([], rng);
      expect(step).toHaveLength(1);
      expect(isColor(step[0] as string)).toBe(true);
    }
  });
});

describe("judge · 前缀正确性", () => {
  it("开局空输入返回 playing，刚好按完返回 correct", () => {
    const seq: SimonColor[] = ["up", "right", "down"];
    expect(judge(seq, [])).toBe("playing");
    expect(judge(seq, ["up"])).toBe("playing");
    expect(judge(seq, ["up", "right"])).toBe("playing");
    expect(judge(seq, ["up", "right", "down"])).toBe("correct");
  });

  it("任一位不同立刻判 wrong", () => {
    const seq: SimonColor[] = ["up", "right", "down"];
    expect(judge(seq, ["right"])).toBe("wrong");
    expect(judge(seq, ["up", "left"])).toBe("wrong");
    expect(judge(seq, ["up", "right", "left"])).toBe("wrong");
  });

  it("多按一步不算对，哪怕前缀完全一致", () => {
    const seq: SimonColor[] = ["left", "up"];
    expect(judge(seq, ["left", "up", "down"])).toBe("wrong");
    expect(judge(seq, ["left", "up", "left"])).toBe("wrong");
  });

  it("空序列不算完成，避免 0 步直接过轮", () => {
    expect(judge([], [])).toBe("playing");
    expect(judge([], ["up"])).toBe("wrong");
  });
});

describe("playbackSpeedForRound · 越来越快但有下限", () => {
  it("第 1 轮是 420ms，随后逐轮线性缩短", () => {
    expect(playbackSpeedForRound(1)).toBe(STEP_MS_START);
    expect(playbackSpeedForRound(2)).toBe(STEP_MS_START - 20);
    expect(playbackSpeedForRound(3)).toBe(STEP_MS_START - 40);
    expect(playbackSpeedForRound(2)).toBeLessThan(playbackSpeedForRound(1));
  });

  it("单调不增，且永不低于 180ms 下限", () => {
    let previous = Number.POSITIVE_INFINITY;
    for (let round = 1; round <= 500; round += 1) {
      const ms = playbackSpeedForRound(round);
      expect(ms).toBeLessThanOrEqual(previous);
      expect(ms).toBeGreaterThanOrEqual(STEP_MS_MIN);
      previous = ms;
    }
  });

  it("速度到顶后夹住：第 200 轮仍是 180ms", () => {
    expect(playbackSpeedForRound(200)).toBe(STEP_MS_MIN);
    expect(playbackSpeedForRound(1000)).toBe(STEP_MS_MIN);
    expect(playbackSpeedForRound(9999)).toBe(STEP_MS_MIN);
  });

  it("步伐长度恒定：下限只影响亮灯时长，不影响停顿时长", () => {
    expect(playbackSpeedForRound(1) + pauseForRound(1)).toBe(STEP_MS_START + GAP_MS);
    expect(playbackSpeedForRound(99) + pauseForRound(99)).toBe(STEP_MS_MIN + GAP_MS);
    expect(pauseForRound(1)).toBe(GAP_MS);
    expect(pauseForRound(1_000)).toBe(GAP_MS);
  });

  it("非法的轮次（0 / 负数 / 小数）按第 1 轮处理", () => {
    expect(playbackSpeedForRound(0)).toBe(STEP_MS_START);
    expect(playbackSpeedForRound(-5)).toBe(STEP_MS_START);
    expect(playbackSpeedForRound(1.9)).toBe(STEP_MS_START);
  });
});

describe("scoreForRound · 计分", () => {
  it("每次正确复现 = 轮次 × 10", () => {
    expect(ROUND_SCORE).toBe(10);
    expect(scoreForRound(1)).toBe(10);
    expect(scoreForRound(7)).toBe(70);
    expect(scoreForRound(30)).toBe(300);
  });

  it("非法轮次不产生负分", () => {
    expect(scoreForRound(0)).toBe(0);
    expect(scoreForRound(-3)).toBe(0);
    expect(scoreForRound(Number.NaN)).toBe(0);
  });
});

describe("阶段机 · 回放期间输入必须被忽略", () => {
  it("createState 开局就在回放阶段，序列只有 1 步", () => {
    const state = createState(seeded(3));
    expect(state.phase).toBe("playing-back");
    expect(state.round).toBe(1);
    expect(state.sequence).toHaveLength(1);
    expect(state.inputs).toEqual([]);
    expect(state.score).toBe(0);
  });

  it("回放阶段按键返回 ignored，并且状态对象原样不动", () => {
    const state = createState(seeded(11));
    const color = state.sequence[0] as SimonColor;

    const outcome = press(state, color);

    expect(outcome.result).toBe("ignored");
    // 引用相等：连一次拷贝都没发生。
    expect(outcome.state).toBe(state);
    expect(state.inputs).toEqual([]);
    expect(state.score).toBe(0);
    expect(state.phase).toBe("playing-back");
  });

  it("回放阶段连按四次错误颜色也不会结束整局", () => {
    let state = createState(seeded(19));
    for (const color of COLORS) {
      const outcome = press(state, color);
      expect(outcome.result).toBe("ignored");
      state = outcome.state;
    }
    expect(state.phase).toBe("playing-back");
    expect(state.inputs).toHaveLength(0);

    // 回放结束之后，同一个颜色立刻生效。
    state = beginInput(state);
    expect(press(state, COLORS[0] as SimonColor).result).not.toBe("ignored");
  });

  it("phase 为 over 后按键同样被忽略", () => {
    const state: SimonState = { ...stateWith(["up"]), phase: "over" };
    const outcome = press(state, "up");
    expect(outcome.result).toBe("ignored");
    expect(outcome.state).toBe(state);
  });
});

describe("press · 复现推进", () => {
  it("按对前缀返回 playing，按完整轮返回 correct 并加分", () => {
    const state = stateWith(["up", "left", "down"], 3);

    const first = press(state, "up");
    expect(first.result).toBe("playing");
    expect(first.state.inputs).toEqual(["up"]);
    expect(first.state.score).toBe(0);

    const second = press(first.state, "left");
    expect(second.result).toBe("playing");

    const third = press(second.state, "down");
    expect(third.result).toBe("correct");
    expect(third.state.inputs).toEqual(["up", "left", "down"]);
    expect(third.state.score).toBe(0 + scoreForRound(3));
    expect(third.state.longest).toBe(3);
  });

  it("按错立刻回到 over，分数不增加", () => {
    const state = { ...stateWith(["up", "right"], 2), score: 40, longest: 4 };
    const outcome = press(state, "down");

    expect(outcome.result).toBe("wrong");
    expect(outcome.state.phase).toBe("over");
    expect(outcome.state.score).toBe(40);
    expect(outcome.state.longest).toBe(4);
  });

  it("按错不修改传入的状态对象（纯函数）", () => {
    const state = stateWith(["up", "right"], 2);
    press(state, "left");
    expect(state.inputs).toEqual([]);
    expect(state.phase).toBe("awaiting-input");
  });
});

describe("advanceRound · 只会向前走", () => {
  it("整轮复现正确后轮次 +1、序列多一步、回到回放", () => {
    const state = stateWith(["up"], 1);
    const done = press(state, "up").state;
    expect(done.score).toBe(10);

    const next = advanceRound(done, seeded(5));

    expect(next.round).toBe(2);
    expect(next.sequence).toHaveLength(2);
    expect(next.sequence[0]).toBe("up");
    expect(next.inputs).toEqual([]);
    expect(next.phase).toBe("playing-back");
    // 分数带到下一轮，不清零。
    expect(next.score).toBe(10);
  });

  it("没按完或阶段不对时原样返回，不会跳轮", () => {
    const partial = press(stateWith(["up", "down"], 2), "up").state;
    expect(advanceRound(partial, seeded(1))).toBe(partial);

    const playing = createState(seeded(2));
    expect(advanceRound(playing, seeded(1))).toBe(playing);
  });
});

describe("replayRound · 重听", () => {
  it("清空已按步骤并回到回放，分数与轮次不变", () => {
    const state = { ...stateWith(["up", "down"], 2), score: 30 };
    const partial = press(state, "up").state;
    expect(partial.inputs).toEqual(["up"]);

    const replayed = replayRound(partial);

    expect(replayed.inputs).toEqual([]);
    expect(replayed.phase).toBe("playing-back");
    expect(replayed.score).toBe(30);
    expect(replayed.round).toBe(2);
    expect(replayed.sequence).toEqual(["up", "down"]);
  });

  it("已结束的局不能重听", () => {
    const over: SimonState = { ...stateWith(["up"]), phase: "over" };
    expect(replayRound(over)).toBe(over);
  });
});

describe("完整一轮的积分累计", () => {
  it("连过 4 轮累计 10 + 20 + 30 + 40 = 100 分", () => {
    const rng = seeded(1234);
    let state = createState(rng);
    let expected = 0;

    for (let round = 1; round <= 4; round += 1) {
      expect(state.round).toBe(round);
      state = beginInput(state);

      for (const color of state.sequence) {
        const outcome = press(state, color);
        expect(outcome.result).not.toBe("wrong");
        state = outcome.state;
      }

      expected += scoreForRound(round);
      expect(state.score).toBe(expected);
      state = advanceRound(state, rng);
    }

    expect(state.round).toBe(5);
    expect(state.sequence).toHaveLength(5);
    expect(state.score).toBe(100);
    expect(state.longest).toBe(4);
  });

  it("回放阶段插入的杂按键不影响接下来的复现", () => {
    const rng = seeded(77);
    let state = beginInput(createState(rng));
    const target = state.sequence.slice();

    // 先假装回放又开始，乱按几下一律 ignored。
    state = replayRound(state);
    for (const color of COLORS) state = press(state, color).state;
    expect(state.inputs).toHaveLength(0);

    state = beginInput(state);
    for (const color of target) state = press(state, color).state;
    expect(state.score).toBe(10);
  });
});
